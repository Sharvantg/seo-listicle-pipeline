/**
 * GET /api/pipeline/[runId]
 * Returns the full pipeline_runs row.
 * Used by all pages for state hydration and resume.
 *
 * Side effect: when status is 'enriching', polls Parallel.ai for completion.
 * If done, fetches results, writes them to enrichment_jobs, and transitions
 * pipeline_runs.status → 'ready_to_generate' before returning.
 * This lets the frontend poll this endpoint without any separate enrichment-check route.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import {
  checkEnrichmentGroupStatus,
  fetchEnrichmentResults,
  parseEnrichmentResults,
} from "@/src/services/enrichment";
import { log } from "@/lib/logger";
import type { EnrichmentJob, PipelineRun } from "@/lib/supabase";
import type { ToolCandidate, ToolData } from "@/src/types";

export async function GET(
  _req: NextRequest,
  { params }: { params: { runId: string } }
) {
  const { runId } = params;

  if (!runId) {
    return NextResponse.json({ error: "runId is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("pipeline_runs")
    .select("*")
    .eq("run_id", runId)
    .single();

  if (error || !data) {
    log.warn("api/pipeline/[runId]", "run not found", {
      runId,
      error: error?.message ?? "no data",
    });
    return NextResponse.json(
      { error: error?.message ?? "Run not found" },
      { status: 404 }
    );
  }

  const run = data as PipelineRun;

  // When enriching: lazily check Parallel.ai and flip status when done
  if (run.status === "enriching" && run.enrichment_run_id) {
    const updated = await checkAndFinalizeEnrichment(run);
    if (updated) {
      return NextResponse.json(updated);
    }
  }

  // When complete: include parsed enriched tool data for the output page
  if (run.status === "complete" && run.enrichment_run_id) {
    const enrichedTools = await loadEnrichedTools(run);
    return NextResponse.json({ ...data, enrichedTools });
  }

  return NextResponse.json(data);
}

/**
 * Check Parallel.ai group status. If all runs are done, fetch results,
 * store in enrichment_jobs, and transition pipeline_runs → ready_to_generate.
 * Returns the updated pipeline_run row, or null if enrichment is still running.
 */
async function checkAndFinalizeEnrichment(
  run: PipelineRun
): Promise<Record<string, unknown> | null> {
  try {
    // Load enrichment job
    const { data: jobData, error: jobError } = await supabase
      .from("enrichment_jobs")
      .select("*")
      .eq("run_id", run.enrichment_run_id!)
      .single();

    if (jobError || !jobData) {
      log.warn("api/pipeline/[runId]", "enrichment_jobs row not found", {
        enrichmentRunId: run.enrichment_run_id,
        error: jobError?.message,
      });
      return null;
    }

    const job = jobData as EnrichmentJob;

    if (!job.parallel_group_id) {
      log.warn("api/pipeline/[runId]", "no parallel_group_id on enrichment job", {
        runId: run.run_id,
      });
      return null;
    }

    // Check if all Parallel runs are complete
    const { allDone, allFailed } = await checkEnrichmentGroupStatus(
      job.parallel_group_id
    );

    if (!allDone) return null; // still processing — return current status to frontend

    log.info("api/pipeline/[runId]", "Parallel enrichment complete — fetching results", {
      runId: run.run_id,
      groupId: job.parallel_group_id,
      allFailed,
    });

    // Fetch individual run results
    const runIds = (job.parallel_run_ids as string[] | null) ?? [];
    let results: Array<{ toolName: string | null; output: string | null; error: string | null }> = [];

    if (runIds.length > 0) {
      results = await fetchEnrichmentResults(runIds, job.tool_names);
    } else {
      log.warn("api/pipeline/[runId]", "no parallel_run_ids stored — cannot fetch results", {
        runId: run.run_id,
      });
    }

    // Store results + flip enrichment_jobs status
    await supabase
      .from("enrichment_jobs")
      .update({
        results,
        status: allFailed ? "failed" : "completed",
        updated_at: new Date().toISOString(),
      })
      .eq("run_id", job.run_id);

    // Flip pipeline_runs → ready_to_generate
    await supabase
      .from("pipeline_runs")
      .update({ status: "ready_to_generate" })
      .eq("run_id", run.run_id)
      .eq("status", "enriching"); // guard against concurrent updates

    log.info("api/pipeline/[runId]", "pipeline transitioned to ready_to_generate", {
      runId: run.run_id,
    });

    // Return fresh row
    const { data: updatedRun } = await supabase
      .from("pipeline_runs")
      .select("*")
      .eq("run_id", run.run_id)
      .single();

    return updatedRun ?? null;
  } catch (err) {
    // Non-fatal: log and fall through to return current (enriching) status
    log.error("api/pipeline/[runId]", "enrichment completion check failed", {
      runId: run.run_id,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * For completed runs: load and parse enriched tool data from enrichment_jobs
 * so the output page can display the full Parallel research.
 */
async function loadEnrichedTools(run: PipelineRun): Promise<ToolData[]> {
  try {
    const { data: job } = await supabase
      .from("enrichment_jobs")
      .select("results, tool_names")
      .eq("run_id", run.enrichment_run_id!)
      .single();

    if (!job?.results) return [];

    const approvedTools = (run.approved_tools ?? []) as ToolCandidate[];
    const keyword = run.keyword;

    return parseEnrichmentResults(
      job.results as Array<{ toolName: string | null; output: string | null; error: string | null }>,
      approvedTools,
      keyword
    );
  } catch {
    return [];
  }
}
