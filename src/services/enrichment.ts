/**
 * Enrichment Service — Parallel.ai Task Group API
 *
 * Flow:
 *  1. Caller invokes submitEnrichmentToParallel() which:
 *     a) Creates a task group (POST /v1beta/tasks/groups)
 *     b) Adds one run per tool (POST /v1beta/tasks/groups/{id}/runs)
 *     c) Returns { groupId, runIds }
 *  2. Caller stores groupId + runIds in Supabase enrichment_jobs
 *  3. GET /api/pipeline/[runId] polls checkEnrichmentGroupStatus() every request
 *     while status is 'enriching'. When Parallel is done, it calls
 *     fetchEnrichmentResults() and flips pipeline_runs.status → 'ready_to_generate'
 *  4. UI detects ready_to_generate and opens the SSE generation stream
 *
 * Auth: x-api-key header (NOT Authorization: Bearer)
 * Endpoint: /v1beta/tasks/groups (NOT /v1/)
 */

import type { ToolCandidate, ToolData } from "../types";
import { log, elapsed } from "../../lib/logger";

const PARALLEL_API_KEY = process.env.PARALLEL_API_KEY!;
const PARALLEL_BASE = "https://api.parallel.ai";

// ─── Response types ────────────────────────────────────────────────────────────

interface ParallelGroupResponse {
  taskgroup_id?: string;       // create group response
  run_ids?: string[];          // add runs response
  status?: {
    is_active?: boolean;
    task_run_status_counts?: {
      queued?: number;
      running?: number;
      completed?: number;
      failed?: number;
    };
  };
}

interface ParallelRunResultResponse {
  run?: { run_id?: string; status?: string };
  output?: { type?: string; content?: string; value?: unknown };
}

// JSON schemas for Parallel's default_task_spec
const INPUT_SCHEMA = {
  type: "object",
  properties: {
    tool_name: { type: "string", description: "Name of the software tool to research" },
    tool_website: { type: "string", description: "Official website URL of the tool" },
    keyword: { type: "string", description: "SEO keyword category for the comparison article" },
  },
  required: ["tool_name", "keyword"],
};

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "Official product name" },
    website: { type: "string", description: "Official website URL" },
    tagline: { type: "string", description: "One-sentence value proposition, max 15 words" },
    bestFor: { type: "string", description: "Ideal customer profile, 1 sentence" },
    strengths: {
      type: "array",
      items: { type: "string" },
      description: "3-4 key strengths as short phrases",
    },
    gaps: {
      type: "array",
      items: { type: "string" },
      description: "2-3 notable limitations or weaknesses",
    },
    pricing: {
      type: "string",
      description: "Pricing summary e.g. 'Free tier + paid from $X/mo' or 'Contact for pricing'",
    },
    pricingUrl: { type: "string", description: "Direct URL to pricing page" },
    g2Rating: { type: "string", description: "G2 rating e.g. '4.5/5' or 'N/A'" },
    capteraRating: { type: "string", description: "Capterra rating or 'N/A'" },
    notableCustomers: {
      type: "array",
      items: { type: "string" },
      description: "2-3 known customer brands",
    },
    category: { type: "string", description: "Primary product category" },
  },
  required: [
    "name", "website", "tagline", "bestFor", "strengths", "gaps",
    "pricing", "pricingUrl", "g2Rating", "capteraRating", "notableCustomers", "category",
  ],
};

export interface EnrichmentSubmission {
  groupId: string;
  runIds: string[];
}

// ─── Submit ────────────────────────────────────────────────────────────────────

/**
 * Submits enrichment tasks to Parallel.ai.
 * Returns { groupId, runIds } on success, null on failure.
 * Does NOT wait for results — caller must poll.
 */
export async function submitEnrichmentToParallel(
  tools: ToolCandidate[],
  keyword: string,
  runId: string,
): Promise<EnrichmentSubmission | null> {
  const t = Date.now();

  log.info("enrichment-service", "submitting to Parallel.ai", {
    keyword,
    runId,
    toolCount: tools.length,
    toolNames: tools.map((t) => t.name),
  });

  // Step 1: Create task group
  const groupId = await createParallelGroup(runId);
  if (!groupId) {
    log.error("enrichment-service", "failed to create Parallel group", { runId, ms: elapsed(t) });
    return null;
  }

  log.info("enrichment-service", "Parallel group created", { groupId, runId });

  // Step 2: Add one run per tool
  const runIds = await addRunsToGroup(groupId, tools, keyword, runId);
  if (!runIds) {
    log.error("enrichment-service", "failed to add runs to Parallel group", {
      groupId,
      runId,
      ms: elapsed(t),
    });
    return null;
  }

  log.info("enrichment-service", "Parallel runs submitted", {
    groupId,
    runCount: runIds.length,
    runIds,
    runId,
    ms: elapsed(t),
  });

  return { groupId, runIds };
}

async function createParallelGroup(runId: string): Promise<string | null> {
  log.info("enrichment-service", "→ POST /v1beta/tasks/groups", { runId });

  try {
    const res = await fetch(`${PARALLEL_BASE}/v1beta/tasks/groups`, {
      method: "POST",
      headers: {
        "x-api-key": PARALLEL_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    const text = await res.text();

    log.info("enrichment-service", "← create group response", {
      status: res.status,
      ok: res.ok,
      body: text.slice(0, 500),
      runId,
    });

    if (!res.ok) {
      log.error("enrichment-service", "create Parallel group HTTP error", {
        status: res.status,
        statusText: res.statusText,
        body: text.slice(0, 500),
        runId,
      });
      return null;
    }

    const data = JSON.parse(text) as ParallelGroupResponse;
    const groupId = data.taskgroup_id ?? null;

    log.info("enrichment-service", "parsed group ID", { groupId, runId });

    if (!groupId) {
      log.error("enrichment-service", "taskgroup_id missing from response", {
        parsedKeys: Object.keys(data),
        body: text.slice(0, 500),
        runId,
      });
    }

    return groupId;
  } catch (err) {
    log.error("enrichment-service", "create Parallel group exception", {
      error: err instanceof Error ? err.message : String(err),
      runId,
    });
    return null;
  }
}

async function addRunsToGroup(
  groupId: string,
  tools: ToolCandidate[],
  keyword: string,
  runId: string,
): Promise<string[] | null> {
  const inputs = tools.map((tool) => ({
    input: {
      tool_name: tool.name,
      tool_website: tool.website ?? "",
      keyword,
    },
    processor: "pro",
  }));

  const body = {
    default_task_spec: {
      input_schema: { json_schema: INPUT_SCHEMA },
      output_schema: { json_schema: OUTPUT_SCHEMA },
    },
    inputs,
  };

  log.info("enrichment-service", `→ POST /v1beta/tasks/groups/${groupId}/runs`, {
    groupId,
    runId,
    inputCount: inputs.length,
    toolNames: inputs.map((i) => (i.input as { tool_name?: string }).tool_name),
    requestBodyPreview: JSON.stringify(body).slice(0, 300),
  });

  try {
    const res = await fetch(`${PARALLEL_BASE}/v1beta/tasks/groups/${groupId}/runs`, {
      method: "POST",
      headers: {
        "x-api-key": PARALLEL_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();

    log.info("enrichment-service", "← add runs response", {
      status: res.status,
      ok: res.ok,
      body: text.slice(0, 500),
      groupId,
      runId,
    });

    if (!res.ok) {
      log.error("enrichment-service", "add runs HTTP error", {
        status: res.status,
        statusText: res.statusText,
        body: text.slice(0, 500),
        groupId,
        runId,
      });
      return null;
    }

    const data = JSON.parse(text) as ParallelGroupResponse;
    const runIds = (data.run_ids ?? []).filter(Boolean);

    log.info("enrichment-service", "parsed run IDs", {
      runIds,
      count: runIds.length,
      parsedKeys: Object.keys(data),
      groupId,
      runId,
    });

    if (runIds.length === 0) {
      log.error("enrichment-service", "Parallel returned no run IDs", {
        parsedKeys: Object.keys(data),
        body: text.slice(0, 500),
        groupId,
        runId,
      });
      return null;
    }

    return runIds;
  } catch (err) {
    log.error("enrichment-service", "add runs exception", {
      error: err instanceof Error ? err.message : String(err),
      groupId,
      runId,
    });
    return null;
  }
}

// ─── Status check ──────────────────────────────────────────────────────────────

export async function checkEnrichmentGroupStatus(groupId: string): Promise<{
  allDone: boolean;
  allFailed: boolean;
  counts: Record<string, number>;
}> {
  try {
    const res = await fetch(`${PARALLEL_BASE}/v1beta/tasks/groups/${groupId}`, {
      headers: { "x-api-key": PARALLEL_API_KEY },
      cache: "no-store",
    });

    if (!res.ok) {
      log.warn("enrichment-service", "Parallel group status check failed", {
        groupId,
        status: res.status,
      });
      return { allDone: false, allFailed: false, counts: {} };
    }

    const data = (await res.json()) as ParallelGroupResponse;
    const counts = data.status?.task_run_status_counts ?? {};
    const queued = counts.queued ?? 0;
    const running = counts.running ?? 0;
    const completed = counts.completed ?? 0;
    const failed = counts.failed ?? 0;
    const total = queued + running + completed + failed;
    const allDone = total > 0 && queued === 0 && running === 0;
    const allFailed = allDone && completed === 0 && failed > 0;

    log.info("enrichment-service", "Parallel group status", {
      groupId,
      queued,
      running,
      completed,
      failed,
      allDone,
    });

    return { allDone, allFailed, counts: { queued, running, completed, failed } };
  } catch (err) {
    log.error("enrichment-service", "exception checking Parallel group status", {
      error: err instanceof Error ? err.message : String(err),
      groupId,
    });
    return { allDone: false, allFailed: false, counts: {} };
  }
}

// ─── Fetch results ─────────────────────────────────────────────────────────────

export async function fetchEnrichmentResults(
  runIds: string[],
  toolNames: string[],
): Promise<Array<{ toolName: string | null; output: string | null; error: string | null }>> {
  const results = await Promise.allSettled(
    runIds.map(async (parallelRunId, i) => {
      const toolName = toolNames[i] ?? null;
      try {
        const res = await fetch(`${PARALLEL_BASE}/v1/tasks/runs/${parallelRunId}/result`, {
          headers: { "x-api-key": PARALLEL_API_KEY },
          cache: "no-store",
        });

        if (!res.ok) {
          const text = await res.text();
          log.warn("enrichment-service", "failed to fetch run result", {
            parallelRunId,
            toolName,
            status: res.status,
            body: text.slice(0, 200),
          });
          return {
            toolName,
            output: null,
            error: `HTTP ${res.status}: ${res.statusText}`,
          };
        }

        const data = (await res.json()) as ParallelRunResultResponse;

        // Parallel returns output.content as a string OR as a JSON object when
        // output_schema is used. Normalise to string so parseEnrichmentResults
        // can handle it uniformly.
        const rawContent = data.output?.content ?? data.output?.value ?? null;
        const output =
          rawContent === null || rawContent === undefined
            ? null
            : typeof rawContent === "string"
            ? rawContent
            : JSON.stringify(rawContent);

        log.info("enrichment-service", "fetched run result", {
          parallelRunId,
          toolName,
          outputType: typeof rawContent,
          outputPreview: output ? output.slice(0, 150) : null,
        });

        return { toolName, output, error: null };
      } catch (err) {
        log.error("enrichment-service", "exception fetching run result", {
          parallelRunId,
          toolName,
          error: err instanceof Error ? err.message : String(err),
        });
        return { toolName, output: null, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );

  return results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return {
      toolName: toolNames[i] ?? null,
      output: null,
      error: String(r.reason),
    };
  });
}

// ─── Parse results ─────────────────────────────────────────────────────────────

/**
 * Parse Parallel results into ToolData[].
 * Called after all run results are fetched and stored in Supabase.
 */
export function parseEnrichmentResults(
  rawResults: Array<{
    toolName: string | null;
    output: string | null;
    error: string | null;
  }>,
  tools: ToolCandidate[],
  keyword: string,
): ToolData[] {
  let parsedCount = 0;
  let fallbackCount = 0;

  const result = tools.map((tool) => {
    const match = rawResults.find(
      (r) => r.toolName?.toLowerCase() === tool.name.toLowerCase(),
    );

    if (!match?.output) {
      log.warn(
        "enrichment-service",
        "no Parallel output for tool — using fallback",
        {
          toolName: tool.name,
          hadMatch: !!match,
          parallelError: match?.error ?? null,
        },
      );
      fallbackCount++;
      return buildFallback(tool, keyword);
    }

    try {
      const jsonMatch = match.output.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        log.warn("enrichment-service", "no JSON in Parallel output for tool", {
          toolName: tool.name,
          outputPreview: match.output.slice(0, 200),
        });
        fallbackCount++;
        return buildFallback(tool, keyword);
      }

      const parsed = JSON.parse(jsonMatch[0]) as Partial<ToolData>;
      parsedCount++;

      return {
        name: parsed.name ?? tool.name,
        website: parsed.website ?? tool.website,
        tagline: parsed.tagline ?? "",
        bestFor: parsed.bestFor ?? "",
        strengths: parsed.strengths ?? [],
        gaps: parsed.gaps ?? [],
        pricing: parsed.pricing ?? "See website for pricing",
        pricingUrl:
          parsed.pricingUrl ?? (tool.website ? `${tool.website}/pricing` : ""),
        g2Rating: parsed.g2Rating ?? "N/A",
        capteraRating: parsed.capteraRating,
        notableCustomers: parsed.notableCustomers ?? [],
        category: parsed.category ?? keyword,
      };
    } catch (err) {
      log.warn("enrichment-service", "failed to parse Parallel output JSON", {
        toolName: tool.name,
        error: err instanceof Error ? err.message : String(err),
      });
      fallbackCount++;
      return buildFallback(tool, keyword);
    }
  });

  log.info("enrichment-service", "parseEnrichmentResults complete", {
    total: tools.length,
    parsed: parsedCount,
    fallback: fallbackCount,
  });

  return result;
}

export function buildFallback(tool: ToolCandidate, keyword: string): ToolData {
  return {
    name: tool.name,
    website: tool.website,
    tagline: "",
    bestFor: "",
    strengths: [],
    gaps: [],
    pricing: "See website for pricing",
    pricingUrl: tool.website ? `${tool.website}/pricing` : "",
    g2Rating: "N/A",
    notableCustomers: [],
    category: keyword,
  };
}
