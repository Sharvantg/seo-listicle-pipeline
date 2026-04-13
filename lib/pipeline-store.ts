/**
 * Server-side helpers for storing pipeline run traces in Supabase.
 * Call these only from API routes (server-side), not client components.
 */

import { supabase } from "./supabase";
import type { PipelineRunStatus } from "./supabase";
import { log } from "./logger";
import type {
  EvalMetricResult,
  EvalResult,
  GeneratedDraft,
  PipelineInput,
  ResearchSynthesis,
  ToolCandidate,
} from "@/src/types";

// ─── Create a run record at research phase (new, full) ────────────────────────

export async function createPipelineRunFull(
  runId: string,
  input: PipelineInput,
  research: ResearchSynthesis,
  toolCandidates: ToolCandidate[]
): Promise<void> {
  const { error } = await supabase.from("pipeline_runs").insert({
    run_id: runId,
    keyword: input.primaryKeyword,
    input,
    research,
    tool_candidates: toolCandidates,
    status: "awaiting_tool_review",
  });

  if (error) {
    log.error("pipeline-store", "createPipelineRunFull failed", { error: error.message, code: error.code, runId });
  } else {
    log.info("pipeline-store", "pipeline run created (awaiting review)", { runId, keyword: input.primaryKeyword });
  }
}

// ─── Save approved tools + enrichment run ID (after user approves) ────────────

export async function saveApprovedToolsAndEnrichment(
  runId: string,
  approvedTools: ToolCandidate[],
  enrichmentRunId: string | null
): Promise<void> {
  const { error } = await supabase
    .from("pipeline_runs")
    .update({
      approved_tools: approvedTools,
      enrichment_run_id: enrichmentRunId,
      status: "enriching",
    })
    .eq("run_id", runId);

  if (error) {
    log.error("pipeline-store", "saveApprovedToolsAndEnrichment failed", { error: error.message, code: error.code, runId });
  } else {
    log.info("pipeline-store", "approved tools saved, status=enriching", { runId, toolCount: approvedTools.length });
  }
}

// ─── Generic status transition ────────────────────────────────────────────────

export async function transitionStatus(
  runId: string,
  status: PipelineRunStatus
): Promise<void> {
  const { error } = await supabase
    .from("pipeline_runs")
    .update({ status })
    .eq("run_id", runId);

  if (error) {
    log.error("pipeline-store", "transitionStatus failed", { error: error.message, code: error.code, runId, status });
  }
}

// ─── Save generated draft to Supabase mid-run ─────────────────────────────────

export async function saveGeneratedDraft(
  runId: string,
  draft: GeneratedDraft
): Promise<void> {
  const { error } = await supabase
    .from("pipeline_runs")
    .update({ final_draft: draft })
    .eq("run_id", runId);

  if (error) {
    log.error("pipeline-store", "saveGeneratedDraft failed", { error: error.message, code: error.code, runId });
  }
}

// ─── Create a run record when generation starts (legacy, kept for old routes) ─

export async function createPipelineRun(
  runId: string,
  input: PipelineInput,
  approvedTools: ToolCandidate[],
  enrichmentRunId: string | null
): Promise<void> {
  const { error } = await supabase.from("pipeline_runs").insert({
    run_id: runId,
    keyword: input.primaryKeyword,
    input,
    approved_tools: approvedTools,
    enrichment_run_id: enrichmentRunId,
    status: "generating",
  });

  if (error) {
    log.error("pipeline-store", "createPipelineRun failed", { error: error.message, code: error.code, runId });
  } else {
    log.info("pipeline-store", "pipeline run created", { runId, keyword: input.primaryKeyword });
  }
}

// ─── Save a score trace (after each /api/eval call) ──────────────────────────

export async function saveScoreTrace(
  runId: string,
  round: number,
  evalScore: number,
  evalPassed: boolean,
  metrics: EvalMetricResult[],
  draft: GeneratedDraft
): Promise<void> {
  const failedMetrics = metrics.filter((m) => !m.passed).map((m) => m.metric);

  const { error } = await supabase.from("eval_traces").insert({
    run_id: runId,
    round,
    stage: "score",
    eval_score: evalScore,
    eval_passed: evalPassed,
    eval_metrics: metrics,
    failed_metrics: failedMetrics,
    draft_word_count: draft.wordCount,
    draft_content: draft.content,
  });

  if (error) {
    log.error("pipeline-store", "saveScoreTrace failed", { error: error.message, code: error.code, runId, round });
  }
}

// ─── Save a revision trace (after each /api/eval/revise call) ────────────────

const STRATEGY_NAMES: Record<number, string> = {
  0: "targeted",
  1: "surgical",
  2: "hard_constraints",
};

export async function saveRevisionTrace(
  runId: string,
  round: number,
  revisionPrompt: string,
  draft: GeneratedDraft
): Promise<void> {
  const { error } = await supabase.from("eval_traces").insert({
    run_id: runId,
    round,
    stage: "revise",
    draft_word_count: draft.wordCount,
    draft_content: draft.content,
    revision_strategy: STRATEGY_NAMES[round] ?? "hard_constraints",
    revision_prompt: revisionPrompt.slice(0, 8000), // cap at 8k chars
  });

  if (error) {
    log.error("pipeline-store", "saveRevisionTrace failed", { error: error.message, code: error.code, runId, round });
  }
}

// ─── Complete a run with final results ───────────────────────────────────────

export async function completePipelineRun(
  runId: string,
  draft: GeneratedDraft,
  evalResult: EvalResult
): Promise<void> {
  const { error } = await supabase
    .from("pipeline_runs")
    .update({
      status: "complete",
      final_draft: draft,
      eval_score: evalResult.overallScore,
      eval_passed: evalResult.passed,
      eval_flagged: evalResult.flaggedForReview,
      eval_retry_count: evalResult.retryCount,
      eval_metrics: evalResult.metrics,
      eval_attempts: evalResult.attempts ?? [],
      completed_at: new Date().toISOString(),
    })
    .eq("run_id", runId);

  if (error) {
    log.error("pipeline-store", "completePipelineRun failed", { error: error.message, code: error.code, runId });
  } else {
    log.info("pipeline-store", "pipeline run completed", {
      runId,
      evalScore: evalResult.overallScore,
      evalPassed: evalResult.passed,
      evalFlagged: evalResult.flaggedForReview,
      retryCount: evalResult.retryCount,
    });
  }
}

// ─── Save score trace overload (accepts EvalResult object) ────────────────────

export async function saveScoreTraceFromResult(
  runId: string,
  round: number,
  evalResult: EvalResult,
  draft: GeneratedDraft
): Promise<void> {
  return saveScoreTrace(runId, round, evalResult.overallScore, evalResult.passed, evalResult.metrics, draft);
}

// ─── Mark a run as errored ────────────────────────────────────────────────────

export async function errorPipelineRun(
  runId: string,
  errorMessage: string
): Promise<void> {
  const { error } = await supabase
    .from("pipeline_runs")
    .update({
      status: "error",
      error: errorMessage,
      completed_at: new Date().toISOString(),
    })
    .eq("run_id", runId);

  if (error) {
    log.error("pipeline-store", "errorPipelineRun failed", { error: error.message, code: error.code, runId });
  } else {
    log.warn("pipeline-store", "pipeline run marked as error", { runId, errorMessage });
  }
}

// ─── Update webflow publish details ──────────────────────────────────────────

export async function updateWebflowDetails(
  runId: string,
  webflowItemId: string,
  webflowEditUrl: string
): Promise<void> {
  const { error } = await supabase
    .from("pipeline_runs")
    .update({ webflow_item_id: webflowItemId, webflow_edit_url: webflowEditUrl })
    .eq("run_id", runId);

  if (error) {
    log.error("pipeline-store", "updateWebflowDetails failed", { error: error.message, code: error.code, runId });
  } else {
    log.info("pipeline-store", "Webflow details saved", { runId, webflowItemId, webflowEditUrl });
  }
}
