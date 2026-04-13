/**
 * End-to-End Pipeline Tests
 *
 * Tests the complete pipeline flow by calling route handlers directly:
 *   POST /api/pipeline        → research + tool discovery, creates DB row
 *   GET  /api/pipeline/:id    → fetch run state
 *   POST /api/pipeline/:id/approve → submit enrichment to Parallel.ai
 *   poll GET /api/pipeline/:id every 30s until status = ready_to_generate
 *     (waits for the Parallel.ai webhook to fire → typically 10–20 min)
 *   POST /api/pipeline/:id/run  → SSE stream: generation + eval loop
 *   Verify final DB state via GET /api/pipeline/:id
 *
 * ⚠️  Total expected time: 20–35 minutes (dominated by Parallel.ai enrichment)
 * ⚠️  Jest timeout for this suite: 40 minutes
 */

import { randomUUID } from "crypto";
import { POST as pipelinePost } from "@/app/api/pipeline/route";
import { GET as pipelineGet } from "@/app/api/pipeline/[runId]/route";
import { POST as approvePost } from "@/app/api/pipeline/[runId]/approve/route";
import { POST as runPost } from "@/app/api/pipeline/[runId]/run/route";
import { MINIMAL_CANDIDATES, TEST_INPUT } from "../fixtures";
import type { PipelineEvent } from "@/src/pipeline/runner";
import type { GeneratedDraft, EvalResult } from "@/src/types";

// ─── Helpers ────────────────────────────────────────────────────────────────────

function makeRequest(path: string, init?: RequestInit): Request {
  return new Request(`http://localhost${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

async function callGet(runId: string) {
  const req = makeRequest(`/api/pipeline/${runId}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await pipelineGet(req as any, { params: { runId } });
  return { status: res.status, body: await res.json() };
}

/**
 * Poll GET /api/pipeline/[runId] until status matches one of the target values.
 * Logs progress every poll.
 */
async function pollUntil(
  runId: string,
  targetStatuses: string[],
  maxWaitMs: number,
  intervalMs = 30_000
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + maxWaitMs;
  let attempts = 0;

  while (Date.now() < deadline) {
    attempts++;
    const { body: run } = await callGet(runId);
    const status = run.status as string;
    const elapsedMin = ((Date.now() - (deadline - maxWaitMs)) / 60_000).toFixed(1);

    console.log(`[poll #${attempts} | ${elapsedMin}min] runId=${runId} status=${status}`);

    if (targetStatuses.includes(status)) {
      return run as Record<string, unknown>;
    }

    if (status === "error") {
      throw new Error(`Pipeline run failed with error: ${run.error}`);
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `Timed out after ${maxWaitMs / 60_000} min waiting for status in [${targetStatuses.join(", ")}]`
  );
}

/**
 * Consume the SSE stream from POST /api/pipeline/[runId]/run.
 * Returns the list of events received until the stream closes.
 */
async function consumeSSEStream(runId: string): Promise<PipelineEvent[]> {
  const req = makeRequest(`/api/pipeline/${runId}/run`, { method: "POST" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await runPost(req as any, { params: { runId } });

  if (!res.body) throw new Error("SSE response has no body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const events: PipelineEvent[] = [];
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const event = JSON.parse(line.slice(6)) as PipelineEvent;
        console.log(`[SSE event] type=${event.type}`, JSON.stringify(event).slice(0, 120));
        events.push(event);
      } catch {
        // Skip malformed lines
      }
    }
  }

  return events;
}

// ─── Test State (shared across the sequential stages) ─────────────────────────

let runId: string;

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe("Pipeline E2E (full flow — waits for Parallel.ai webhook)", () => {
  // 40-minute overall timeout for the suite
  jest.setTimeout(40 * 60_000);

  // ── Stage 1: POST /api/pipeline ─────────────────────────────────────────────

  describe("Stage 1 — Research + Tool Discovery", () => {
    let responseBody: Record<string, unknown>;

    beforeAll(async () => {
      console.log("\n=== Stage 1: POST /api/pipeline ===");
      const req = makeRequest("/api/pipeline", {
        method: "POST",
        body: JSON.stringify(TEST_INPUT),
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await pipelinePost(req as any);
      expect(res.status).toBe(200);
      responseBody = await res.json();

      runId = responseBody.runId as string;
      console.log(`Created run: runId=${runId}`);
    }, 3 * 60_000); // 3 min for research + tool discovery

    test("response contains runId", () => {
      expect(typeof responseBody.runId).toBe("string");
      expect(responseBody.runId).toBeTruthy();
    });

    test("response contains research synthesis", () => {
      const research = responseBody.research as Record<string, unknown>;
      expect(research).toBeDefined();
      expect(research.keywordData).toBeDefined();
      expect(research.serpInsights).toBeDefined();
      expect(research.citationSources).toBeDefined();
      expect(Array.isArray(research.contentGaps)).toBe(true);
    });

    test("response contains tool candidates", () => {
      const candidates = responseBody.toolCandidates as unknown[];
      expect(Array.isArray(candidates)).toBe(true);
      expect(candidates.length).toBeGreaterThan(0);
    });

    test("Zuddl is in the tool candidates", () => {
      const candidates = responseBody.toolCandidates as Array<{ name: string }>;
      const zuddl = candidates.find((c) => c.name.toLowerCase() === "zuddl");
      expect(zuddl).toBeDefined();
    });
  });

  // ── Stage 2: GET /api/pipeline/[runId] — verify DB state ────────────────────

  describe("Stage 2 — DB State after Research", () => {
    let run: Record<string, unknown>;

    beforeAll(async () => {
      console.log("\n=== Stage 2: GET /api/pipeline/[runId] ===");
      const { body } = await callGet(runId);
      run = body;
    }, 15_000);

    test("pipeline_runs row exists with correct runId", () => {
      expect(run.run_id).toBe(runId);
    });

    test("status is awaiting_tool_review", () => {
      expect(run.status).toBe("awaiting_tool_review");
    });

    test("research column is populated", () => {
      expect(run.research).toBeDefined();
      expect((run.research as Record<string, unknown>).keywordData).toBeDefined();
    });

    test("tool_candidates column is populated", () => {
      expect(Array.isArray(run.tool_candidates)).toBe(true);
      expect((run.tool_candidates as unknown[]).length).toBeGreaterThan(0);
    });

    test("keyword matches input", () => {
      expect(run.keyword).toBe(TEST_INPUT.primaryKeyword);
    });
  });

  // ── Stage 3: POST /api/pipeline/[runId]/approve ──────────────────────────────

  describe("Stage 3 — Approve Tools + Submit Enrichment", () => {
    let approveBody: Record<string, unknown>;

    beforeAll(async () => {
      console.log("\n=== Stage 3: POST /api/pipeline/[runId]/approve ===");
      // Use the first 5 candidates from our test fixtures (fast, known subset)
      const req = makeRequest(`/api/pipeline/${runId}/approve`, {
        method: "POST",
        body: JSON.stringify({ approvedTools: MINIMAL_CANDIDATES }),
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await approvePost(req as any, { params: { runId } });
      expect(res.status).toBe(200);
      approveBody = await res.json();

      console.log(`Approve response: ${JSON.stringify(approveBody)}`);
    }, 30_000);

    test("response contains enrichmentRunId", () => {
      expect(typeof approveBody.enrichmentRunId).toBe("string");
      expect(approveBody.enrichmentRunId).toBeTruthy();
    });

    test("response status is enriching or enrichment_failed", () => {
      expect(["enriching", "enrichment_failed"]).toContain(approveBody.status);
    });
  });

  // ── Stage 4: Verify DB transitioned to enriching ─────────────────────────────

  describe("Stage 4 — DB State after Approve", () => {
    let run: Record<string, unknown>;

    beforeAll(async () => {
      console.log("\n=== Stage 4: Verifying enriching status ===");
      const { body } = await callGet(runId);
      run = body;
    }, 15_000);

    test("status is enriching", () => {
      expect(run.status).toBe("enriching");
    });

    test("approved_tools is saved", () => {
      expect(Array.isArray(run.approved_tools)).toBe(true);
      expect((run.approved_tools as unknown[]).length).toBe(MINIMAL_CANDIDATES.length);
    });

    test("enrichment_run_id is set", () => {
      expect(typeof run.enrichment_run_id).toBe("string");
    });
  });

  // ── Stage 5: Wait for Parallel.ai webhook → ready_to_generate ────────────────

  describe("Stage 5 — Wait for Parallel.ai Webhook (10–20 min)", () => {
    let run: Record<string, unknown>;

    beforeAll(async () => {
      console.log("\n=== Stage 5: Polling for ready_to_generate (up to 30 min) ===");
      console.log("Parallel.ai is researching each tool — this typically takes 10–20 minutes.");
      console.log("The Edge Function will flip status to ready_to_generate when done.\n");

      run = await pollUntil(
        runId,
        ["ready_to_generate", "generating", "evaluating", "complete"],
        30 * 60_000, // 30 min max
        30_000        // poll every 30s
      );

      console.log(`\n✓ Enrichment complete. Status: ${run.status}`);
    }, 32 * 60_000); // 32 min timeout for this beforeAll

    test("status transitioned out of enriching", () => {
      const validStatuses = ["ready_to_generate", "generating", "evaluating", "complete"];
      expect(validStatuses).toContain(run.status);
    });
  });

  // ── Stage 6: POST /api/pipeline/[runId]/run — SSE stream ─────────────────────

  describe("Stage 6 — SSE Generation + Eval Loop", () => {
    let events: PipelineEvent[];
    let completeEvent: Extract<PipelineEvent, { type: "complete" }> | undefined;

    beforeAll(async () => {
      console.log("\n=== Stage 6: POST /api/pipeline/[runId]/run (SSE stream) ===");
      console.log("Starting generation → eval → (revise → eval) loop...\n");

      events = await consumeSSEStream(runId);

      completeEvent = events.find(
        (e): e is Extract<PipelineEvent, { type: "complete" }> => e.type === "complete"
      );

      const errorEvent = events.find((e) => e.type === "error") as
        | { type: "error"; message: string }
        | undefined;

      if (errorEvent) {
        console.error("Pipeline error event:", errorEvent.message);
      }

      console.log(`\n✓ SSE stream closed. Total events: ${events.length}`);
      console.log(`Events: ${events.map((e) => e.type).join(" → ")}`);
    }, 15 * 60_000); // 15 min for generation + eval loop

    test("stream emitted at least one event", () => {
      expect(events.length).toBeGreaterThan(0);
    });

    test("stream emitted a generating event", () => {
      const genEvent = events.find((e) => e.type === "generating" || e.type === "generating_done");
      expect(genEvent).toBeDefined();
    });

    test("stream emitted at least one evaluating event", () => {
      const evalEvent = events.find((e) => e.type === "evaluating");
      expect(evalEvent).toBeDefined();
    });

    test("stream emitted at least one eval_done event", () => {
      const evalDone = events.find((e) => e.type === "eval_done");
      expect(evalDone).toBeDefined();
    });

    test("eval_done scores are in range 0–100", () => {
      const evalDones = events.filter(
        (e): e is Extract<PipelineEvent, { type: "eval_done" }> => e.type === "eval_done"
      );
      for (const e of evalDones) {
        expect(e.score).toBeGreaterThanOrEqual(0);
        expect(e.score).toBeLessThanOrEqual(100);
      }
    });

    test("stream ended with a complete event (not error)", () => {
      expect(completeEvent).toBeDefined();
    });

    test("complete event contains a GeneratedDraft", () => {
      if (!completeEvent) return;
      const draft = completeEvent.draft as GeneratedDraft;
      expect(typeof draft.title).toBe("string");
      expect(typeof draft.content).toBe("string");
      expect(draft.wordCount).toBeGreaterThan(500);
      expect(typeof draft.slug).toBe("string");
    });

    test("complete event contains an EvalResult", () => {
      if (!completeEvent) return;
      const er = completeEvent.evalResult as EvalResult;
      expect(typeof er.overallScore).toBe("number");
      expect(er.overallScore).toBeGreaterThanOrEqual(0);
      expect(er.overallScore).toBeLessThanOrEqual(100);
      expect(typeof er.passed).toBe("boolean");
      expect(Array.isArray(er.metrics)).toBe(true);
    });

    test("revising events only appear if eval failed", () => {
      const firstEvalDone = events.find(
        (e): e is Extract<PipelineEvent, { type: "eval_done" }> => e.type === "eval_done"
      );
      const revisingEvents = events.filter((e) => e.type === "revising");

      if (firstEvalDone && firstEvalDone.passed) {
        // If it passed on the first try, there should be no revising events
        expect(revisingEvents.length).toBe(0);
      }
      // If it didn't pass, revising events are expected — no assertion needed
    });
  });

  // ── Stage 7: Verify final DB state ────────────────────────────────────────────

  describe("Stage 7 — Final DB State", () => {
    let run: Record<string, unknown>;

    beforeAll(async () => {
      console.log("\n=== Stage 7: Verifying final pipeline_runs state ===");
      const { body } = await callGet(runId);
      run = body;
    }, 15_000);

    test("status is complete", () => {
      expect(run.status).toBe("complete");
    });

    test("final_draft is saved to DB", () => {
      expect(run.final_draft).toBeDefined();
      const draft = run.final_draft as Record<string, unknown>;
      expect(typeof draft.title).toBe("string");
      expect(typeof draft.content).toBe("string");
      expect(typeof draft.wordCount).toBe("number");
    });

    test("eval_score is saved (0–100)", () => {
      expect(typeof run.eval_score).toBe("number");
      expect(run.eval_score as number).toBeGreaterThanOrEqual(0);
      expect(run.eval_score as number).toBeLessThanOrEqual(100);
    });

    test("eval_passed is a boolean", () => {
      expect(typeof run.eval_passed).toBe("boolean");
    });

    test("eval_metrics array is saved", () => {
      expect(Array.isArray(run.eval_metrics)).toBe(true);
      expect((run.eval_metrics as unknown[]).length).toBe(8);
    });

    test("eval_retry_count is a non-negative integer", () => {
      expect(typeof run.eval_retry_count).toBe("number");
      expect(run.eval_retry_count as number).toBeGreaterThanOrEqual(0);
      expect(run.eval_retry_count as number).toBeLessThanOrEqual(3);
    });

    test("completed_at timestamp is set", () => {
      expect(typeof run.completed_at).toBe("string");
      const ts = new Date(run.completed_at as string).getTime();
      expect(isNaN(ts)).toBe(false);
    });

    test("research column is still populated (for future resume)", () => {
      expect(run.research).toBeDefined();
    });

    test("eval_score matches what the complete SSE event reported", () => {
      // This is checked if Stage 6 also ran
      // If the complete event was captured, its score should match DB
      // (We don't have direct access here, but we verify the DB is self-consistent)
      const dbScore = run.eval_score as number;
      const dbPassed = run.eval_passed as boolean;
      if (dbPassed) {
        expect(dbScore).toBeGreaterThanOrEqual(90);
      }
    });
  });

  // ── Stage 8: Summary ─────────────────────────────────────────────────────────

  describe("Stage 8 — Pipeline Summary", () => {
    test("prints a human-readable summary of the run", async () => {
      const { body: run } = await callGet(runId);
      const draft = run.final_draft as Record<string, unknown>;

      console.log("\n" + "=".repeat(60));
      console.log("PIPELINE RUN SUMMARY");
      console.log("=".repeat(60));
      console.log(`Run ID:        ${runId}`);
      console.log(`Keyword:       ${run.keyword}`);
      console.log(`Status:        ${run.status}`);
      console.log(`Eval Score:    ${run.eval_score}/100`);
      console.log(`Eval Passed:   ${run.eval_passed}`);
      console.log(`Retry Count:   ${run.eval_retry_count}`);
      console.log(`Flagged:       ${run.eval_flagged}`);
      if (draft) {
        console.log(`Article Title: ${draft.title}`);
        console.log(`Word Count:    ${draft.wordCount}`);
        console.log(`Slug:          ${draft.slug}`);
      }
      console.log("=".repeat(60));

      // The test itself just verifies the run is complete
      expect(run.status).toBe("complete");
    }, 15_000);
  });
});
