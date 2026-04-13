/**
 * E2E test for "virtual event management software" keyword.
 * Runs the full pipeline: research → tool discovery → approve (Parallel enrichment)
 * → poll until ready_to_generate → SSE generation + eval loop → complete.
 *
 * Expected duration: 20–35 minutes (Parallel.ai enrichment takes 10–20 min).
 */

import { POST as pipelinePost } from "@/app/api/pipeline/route";
import { GET as pipelineGet } from "@/app/api/pipeline/[runId]/route";
import { POST as approvePost } from "@/app/api/pipeline/[runId]/approve/route";
import { POST as runPost } from "@/app/api/pipeline/[runId]/run/route";
import type { PipelineEvent } from "@/src/pipeline/runner";
import type { PipelineInput } from "@/src/types";
import type { GeneratedDraft, EvalResult } from "@/src/types";

const TEST_INPUT: PipelineInput = {
  primaryKeyword: "virtual event management software",
  secondaryKeywords: ["virtual event platform", "online event management", "hybrid event software"],
  toolCount: 7,
  notes: "Focus on enterprise B2B. Zuddl is the featured tool. Include Zuddl as #1.",
};

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

    console.log(`[poll #${attempts} | ${elapsedMin}min] status=${status} runId=${runId}`);

    if (targetStatuses.includes(status)) return run as Record<string, unknown>;
    if (status === "error") throw new Error(`Pipeline failed: ${run.error}`);

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timed out after ${maxWaitMs / 60_000}min waiting for [${targetStatuses.join(", ")}]`);
}

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
        console.log(`[SSE] type=${event.type}`, JSON.stringify(event).slice(0, 150));
        events.push(event);
      } catch { /* skip malformed */ }
    }
  }
  return events;
}

// ─── Shared state ────────────────────────────────────────────────────────────

let runId: string;
let toolCandidates: Array<{ name: string; website: string; confidence: number; source: string }>;

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('Pipeline E2E — "virtual event management software"', () => {
  jest.setTimeout(42 * 60_000); // 42 minutes total

  // ── Stage 1: Research + Tool Discovery ────────────────────────────────────

  describe("Stage 1 — Research + Tool Discovery", () => {
    let body: Record<string, unknown>;

    beforeAll(async () => {
      console.log('\n=== Stage 1: POST /api/pipeline (keyword: "virtual event management software") ===');
      const req = makeRequest("/api/pipeline", {
        method: "POST",
        body: JSON.stringify(TEST_INPUT),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await pipelinePost(req as any);
      expect(res.status).toBe(200);
      body = await res.json();
      runId = body.runId as string;
      toolCandidates = body.toolCandidates as typeof toolCandidates;
      console.log(`runId: ${runId}`);
      console.log(`Tool candidates: ${toolCandidates.map((t) => t.name).join(", ")}`);
    }, 3 * 60_000);

    test("returns runId", () => expect(typeof runId).toBe("string"));
    test("returns research synthesis", () => {
      const r = body.research as Record<string, unknown>;
      expect(r?.keywordData).toBeDefined();
      expect(r?.serpInsights).toBeDefined();
    });
    test("returns tool candidates", () => {
      expect(Array.isArray(toolCandidates)).toBe(true);
      expect(toolCandidates.length).toBeGreaterThan(0);
    });
    test("Zuddl is in candidates", () => {
      expect(toolCandidates.some((t) => t.name.toLowerCase() === "zuddl")).toBe(true);
    });
  });

  // ── Stage 2: DB state ─────────────────────────────────────────────────────

  describe("Stage 2 — DB State after Research", () => {
    let run: Record<string, unknown>;
    beforeAll(async () => {
      const { body } = await callGet(runId);
      run = body;
    }, 15_000);

    test("run exists with awaiting_tool_review status", () => {
      expect(run.run_id).toBe(runId);
      expect(run.status).toBe("awaiting_tool_review");
    });
    test("research + tool_candidates columns populated", () => {
      expect(run.research).toBeDefined();
      expect(Array.isArray(run.tool_candidates)).toBe(true);
    });
  });

  // ── Stage 3: Approve tools ────────────────────────────────────────────────

  describe("Stage 3 — Approve Tools + Submit to Parallel", () => {
    let approveBody: Record<string, unknown>;

    beforeAll(async () => {
      console.log("\n=== Stage 3: Approving tools ===");
      // Use all discovered candidates (up to 7)
      const toApprove = toolCandidates.slice(0, 7);
      console.log(`Approving ${toApprove.length} tools: ${toApprove.map((t) => t.name).join(", ")}`);

      const req = makeRequest(`/api/pipeline/${runId}/approve`, {
        method: "POST",
        body: JSON.stringify({ approvedTools: toApprove }),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await approvePost(req as any, { params: { runId } });
      expect(res.status).toBe(200);
      approveBody = await res.json();
      console.log(`Approve response: ${JSON.stringify(approveBody)}`);
    }, 30_000);

    test("response contains enrichmentRunId", () => {
      expect(typeof approveBody.enrichmentRunId).toBe("string");
    });
    test("response status is enriching (Parallel accepted)", () => {
      // If this fails with 'enrichment_failed', check server logs for the Parallel API error
      expect(approveBody.status).toBe("enriching");
    });
    test("parallelGroupId is set", () => {
      console.log(`Parallel group ID: ${approveBody.parallelGroupId}`);
      expect(typeof approveBody.parallelGroupId).toBe("string");
      expect(approveBody.parallelGroupId).toBeTruthy();
    });
  });

  // ── Stage 4: Poll until Parallel completes ────────────────────────────────

  describe("Stage 4 — Wait for Parallel.ai (10–20 min)", () => {
    let run: Record<string, unknown>;

    beforeAll(async () => {
      console.log("\n=== Stage 4: Polling GET /api/pipeline/[runId] every 30s ===");
      console.log("Waiting for Parallel to finish enrichment and status → ready_to_generate...\n");
      run = await pollUntil(
        runId,
        ["ready_to_generate", "generating", "evaluating", "complete"],
        30 * 60_000,
        30_000
      );
      console.log(`\n✓ Enrichment done. Status: ${run.status}`);
    }, 32 * 60_000);

    test("status transitioned out of enriching", () => {
      expect(["ready_to_generate", "generating", "evaluating", "complete"]).toContain(run.status);
    });
  });

  // ── Stage 5: SSE generation + eval loop ──────────────────────────────────

  describe("Stage 5 — SSE Generation + Eval Loop", () => {
    let events: PipelineEvent[];
    let completeEvent: Extract<PipelineEvent, { type: "complete" }> | undefined;

    beforeAll(async () => {
      console.log("\n=== Stage 5: POST /api/pipeline/[runId]/run (SSE) ===");
      events = await consumeSSEStream(runId);
      completeEvent = events.find(
        (e): e is Extract<PipelineEvent, { type: "complete" }> => e.type === "complete"
      );
      const errorEvent = events.find((e) => e.type === "error") as { type: "error"; message: string } | undefined;
      if (errorEvent) console.error("Pipeline error:", errorEvent.message);
      console.log(`\n✓ SSE closed. Events: ${events.map((e) => e.type).join(" → ")}`);
    }, 15 * 60_000);

    test("stream has events", () => expect(events.length).toBeGreaterThan(0));
    test("generating event emitted", () => {
      expect(events.some((e) => e.type === "generating" || e.type === "generating_done")).toBe(true);
    });
    test("evaluating event emitted", () => {
      expect(events.some((e) => e.type === "evaluating")).toBe(true);
    });
    test("stream ended with complete event", () => expect(completeEvent).toBeDefined());
    test("draft has title and content", () => {
      if (!completeEvent) return;
      const draft = completeEvent.draft as GeneratedDraft;
      expect(draft.title.toLowerCase()).toContain("virtual event management");
      expect(draft.wordCount).toBeGreaterThan(500);
    });
    test("eval score is in range", () => {
      if (!completeEvent) return;
      const er = completeEvent.evalResult as EvalResult;
      expect(er.overallScore).toBeGreaterThanOrEqual(0);
      expect(er.overallScore).toBeLessThanOrEqual(100);
    });
  });

  // ── Stage 6: Final DB state ───────────────────────────────────────────────

  describe("Stage 6 — Final DB State", () => {
    let run: Record<string, unknown>;
    beforeAll(async () => {
      const { body } = await callGet(runId);
      run = body;
    }, 15_000);

    test("status is complete", () => expect(run.status).toBe("complete"));
    test("final_draft saved", () => {
      expect(run.final_draft).toBeDefined();
      expect(typeof (run.final_draft as Record<string, unknown>).title).toBe("string");
    });
    test("eval_score saved", () => {
      expect(typeof run.eval_score).toBe("number");
    });

    afterAll(() => {
      const draft = run?.final_draft as Record<string, unknown> | undefined;
      console.log("\n" + "=".repeat(60));
      console.log("PIPELINE SUMMARY");
      console.log("=".repeat(60));
      console.log(`Run ID:      ${runId}`);
      console.log(`Keyword:     ${run?.keyword}`);
      console.log(`Status:      ${run?.status}`);
      console.log(`Eval Score:  ${run?.eval_score}/100 (passed: ${run?.eval_passed})`);
      console.log(`Retry Count: ${run?.eval_retry_count}`);
      console.log(`Flagged:     ${run?.eval_flagged}`);
      if (draft) {
        console.log(`Title:       ${draft.title}`);
        console.log(`Words:       ${draft.wordCount}`);
      }
      console.log("=".repeat(60));
    });
  });
});
