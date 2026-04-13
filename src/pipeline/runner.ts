/**
 * Pipeline Runner
 *
 * Drives the server-side eval loop: generation → eval → [revise → eval] → complete.
 * Called by POST /api/pipeline/[runId]/run (SSE endpoint).
 *
 * Replaces the orchestration logic that previously lived in app/generating/page.tsx.
 */

import { supabase } from "../../lib/supabase";
import {
  transitionStatus,
  saveGeneratedDraft,
  saveScoreTrace,
  saveRevisionTrace,
  completePipelineRun,
  errorPipelineRun,
} from "../../lib/pipeline-store";
import { runGenerationAgent } from "../agents/generation-agent";
import { runEvalAgent } from "../agents/eval-agent";
import { runRevisionAgent } from "../agents/revision-agent";
import { parseEnrichmentResults, buildFallback } from "../services/enrichment";
import type {
  GeneratedDraft,
  EvalResult,
  PipelineInput,
  ResearchSynthesis,
  ToolCandidate,
  ToolData,
} from "../types";
import type { PipelineRun, EnrichmentJob } from "../../lib/supabase";
import { log, elapsed } from "../../lib/logger";

const BENCHMARK_AVG_WORD_COUNT = 2800;
const MAX_REVISION_ROUNDS = 3;

export type EmitFn = (data: PipelineEvent) => void;

export type PipelineEvent =
  | { type: "generating"; detail: string }
  | { type: "generating_done"; wordCount: number }
  | { type: "evaluating"; round: number }
  | { type: "eval_done"; round: number; score: number; passed: boolean }
  | { type: "revising"; round: number }
  | { type: "complete"; draft: GeneratedDraft; evalResult: EvalResult }
  | { type: "error"; message: string };

export async function runPipelinePhase(runId: string, emit: EmitFn): Promise<void> {
  const t = Date.now();
  log.info("pipeline-runner", "start", { runId });

  // Load the pipeline run from Supabase
  const { data: runData, error: runError } = await supabase
    .from("pipeline_runs")
    .select("*")
    .eq("run_id", runId)
    .single();

  if (runError || !runData) {
    const msg = runError?.message ?? "Pipeline run not found";
    log.error("pipeline-runner", "failed to load run", { runId, error: msg });
    emit({ type: "error", message: msg });
    return;
  }

  const run = runData as PipelineRun;
  const input = run.input as unknown as PipelineInput;
  const research = run.research as unknown as ResearchSynthesis;

  if (!input || !research) {
    const msg = "Pipeline run is missing input or research data";
    log.error("pipeline-runner", msg, { runId });
    emit({ type: "error", message: msg });
    return;
  }

  // Load enriched tools from enrichment_jobs
  let enrichedTools: ToolData[];
  try {
    enrichedTools = await getEnrichedTools(run.enrichment_run_id, run.approved_tools as unknown as ToolCandidate[], input.primaryKeyword);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load enriched tools";
    log.error("pipeline-runner", "getEnrichedTools failed", { runId, error: msg });
    emit({ type: "error", message: msg });
    return;
  }

  try {
    // ── Generation (resume-aware: skip if draft already saved) ────────────────
    let draft: GeneratedDraft;

    if (
      (run.status === "evaluating" || run.status === "revising") &&
      run.final_draft
    ) {
      draft = run.final_draft as unknown as GeneratedDraft;
      log.info("pipeline-runner", "resuming from saved draft", {
        runId,
        wordCount: draft.wordCount,
        status: run.status,
      });
    } else {
      emit({ type: "generating", detail: "Writing article..." });
      await transitionStatus(runId, "generating");

      draft = await runGenerationAgent(input, research, enrichedTools);
      await saveGeneratedDraft(runId, draft);

      emit({ type: "generating_done", wordCount: draft.wordCount });
      log.info("pipeline-runner", "generation complete", { runId, wordCount: draft.wordCount });
    }

    // ── Eval loop ─────────────────────────────────────────────────────────────
    let round = run.current_revision_round ?? 0;

    await transitionStatus(runId, "evaluating");
    emit({ type: "evaluating", round });

    let evalResult = await runEvalAgent(draft, input, BENCHMARK_AVG_WORD_COUNT, round);
    await saveScoreTrace(runId, round, evalResult.overallScore, evalResult.passed, evalResult.metrics, draft);

    emit({ type: "eval_done", round, score: evalResult.overallScore, passed: evalResult.passed });
    log.info("pipeline-runner", "initial eval complete", {
      runId,
      round,
      score: evalResult.overallScore,
      passed: evalResult.passed,
    });

    while (!evalResult.passed && round < MAX_REVISION_ROUNDS) {
      await transitionStatus(runId, "revising");
      await supabase
        .from("pipeline_runs")
        .update({ current_revision_round: round })
        .eq("run_id", runId);

      emit({ type: "revising", round });
      log.info("pipeline-runner", "starting revision", { runId, round });

      draft = await runRevisionAgent(
        draft,
        evalResult,
        input,
        research,
        round,
        BENCHMARK_AVG_WORD_COUNT,
        runId
      );
      await saveGeneratedDraft(runId, draft);

      round++;

      await transitionStatus(runId, "evaluating");
      emit({ type: "evaluating", round });

      evalResult = await runEvalAgent(draft, input, BENCHMARK_AVG_WORD_COUNT, round);
      await saveScoreTrace(runId, round, evalResult.overallScore, evalResult.passed, evalResult.metrics, draft);

      emit({ type: "eval_done", round, score: evalResult.overallScore, passed: evalResult.passed });
      log.info("pipeline-runner", "post-revision eval", {
        runId,
        round,
        score: evalResult.overallScore,
        passed: evalResult.passed,
      });
    }

    const finalEvalResult: EvalResult = {
      ...evalResult,
      retryCount: round,
      flaggedForReview: !evalResult.passed,
    };

    await completePipelineRun(runId, draft, finalEvalResult);

    emit({ type: "complete", draft, evalResult: finalEvalResult });
    log.info("pipeline-runner", "complete", {
      runId,
      ms: elapsed(t),
      score: finalEvalResult.overallScore,
      passed: finalEvalResult.passed,
      rounds: round,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Pipeline failed";
    log.error("pipeline-runner", "failed", { runId, error: msg, ms: elapsed(t) });
    await errorPipelineRun(runId, msg);
    emit({ type: "error", message: msg });
  }
}

// ─── Helper: get enriched tools from enrichment_jobs ─────────────────────────

async function getEnrichedTools(
  enrichmentRunId: string | null,
  approvedTools: ToolCandidate[],
  keyword: string
): Promise<ToolData[]> {
  if (!enrichmentRunId) {
    log.warn("pipeline-runner", "no enrichmentRunId — using fallback tool data", { keyword });
    return (approvedTools ?? []).map((t) => buildFallback(t, keyword));
  }

  const { data, error } = await supabase
    .from("enrichment_jobs")
    .select("*")
    .eq("run_id", enrichmentRunId)
    .single();

  if (error || !data) {
    log.warn("pipeline-runner", "enrichment_jobs row not found — using fallback", {
      enrichmentRunId,
      error: error?.message,
    });
    return (approvedTools ?? []).map((t) => buildFallback(t, keyword));
  }

  const job = data as EnrichmentJob;

  if (job.status === "failed" || !job.results) {
    log.warn("pipeline-runner", "enrichment job failed or no results — using fallback", {
      enrichmentRunId,
      status: job.status,
    });
    return job.tool_names.map((name) =>
      buildFallback({ name, website: "", confidence: 0, source: "fallback" }, keyword)
    );
  }

  // Use approvedTools (which has website info) for fallback building
  return parseEnrichmentResults(job.results, approvedTools ?? [], keyword);
}
