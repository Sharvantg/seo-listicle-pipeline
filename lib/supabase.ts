import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ─── Pipeline Runs ────────────────────────────────────────────────────────────

export type PipelineRunStatus =
  | "researching"
  | "awaiting_tool_review"
  | "enriching"
  | "ready_to_generate"
  | "generating"
  | "evaluating"
  | "revising"
  | "complete"
  | "error";

export interface PipelineRun {
  id: string;
  run_id: string;
  keyword: string;
  input: Record<string, unknown>;
  research: Record<string, unknown> | null;       // ResearchSynthesis for resume
  tool_candidates: unknown[] | null;              // ToolCandidate[] pre-review
  approved_tools: unknown[] | null;
  enrichment_run_id: string | null;
  status: PipelineRunStatus;
  current_revision_round: number;
  final_draft: Record<string, unknown> | null;
  eval_score: number | null;
  eval_passed: boolean | null;
  eval_flagged: boolean;
  eval_retry_count: number;
  eval_metrics: unknown[] | null;
  eval_attempts: unknown[] | null;
  error: string | null;
  webflow_item_id: string | null;
  webflow_edit_url: string | null;
  created_at: string;
  completed_at: string | null;
}

// ─── Eval Traces ─────────────────────────────────────────────────────────────

export interface EvalTrace {
  id: string;
  run_id: string;
  round: number;
  stage: "score" | "revise";
  eval_score: number | null;
  eval_passed: boolean | null;
  eval_metrics: unknown[] | null;
  failed_metrics: string[] | null;
  draft_word_count: number | null;
  draft_content: string | null;
  revision_strategy: string | null;
  revision_prompt: string | null;
  created_at: string;
}

// ─── Enrichment Jobs ─────────────────────────────────────────────────────────

export interface EnrichmentJob {
  id: string;
  run_id: string;
  parallel_group_id: string | null;
  parallel_run_ids: string[] | null;
  keyword: string;
  tool_count: number;
  tool_names: string[];
  status: "pending" | "processing" | "completed" | "failed";
  results: Array<{
    toolName: string | null;
    output: string | null;
    error: string | null;
  }> | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}
