/**
 * GET /api/debug-enriched?runId=...
 * Temporary diagnostic: tests the exact same DB queries as the GET /api/pipeline/[runId] route
 * to verify what values are returned at runtime in production.
 * DELETE THIS FILE after diagnosis.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const runId = req.nextUrl.searchParams.get("runId") ?? "85a8a88a-4965-48d4-90cf-994f8fcf1696";

  // Query 1: pipeline_runs
  const { data: run, error: runError } = await supabase
    .from("pipeline_runs")
    .select("run_id, status, enrichment_run_id")
    .eq("run_id", runId)
    .single();

  // Query 2: enrichment_jobs
  const { data: job, error: jobError } = await supabase
    .from("enrichment_jobs")
    .select("run_id, status, results, tool_names")
    .eq("run_id", runId)
    .single();

  const conditionStatus = run?.status === "complete";
  const conditionEnrichId = !!run?.enrichment_run_id;

  return NextResponse.json({
    run: {
      status: run?.status ?? null,
      enrichment_run_id: run?.enrichment_run_id ?? null,
      error: runError?.message ?? null,
    },
    job: {
      run_id: job?.run_id ?? null,
      status: job?.status ?? null,
      hasResults: Array.isArray(job?.results),
      resultsLength: Array.isArray(job?.results) ? (job.results as unknown[]).length : null,
      error: jobError?.message ?? null,
    },
    condition: {
      statusIsComplete: conditionStatus,
      enrichmentRunIdTruthy: conditionEnrichId,
      bothTrue: conditionStatus && conditionEnrichId,
    },
  });
}
