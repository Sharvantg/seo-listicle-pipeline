/**
 * POST /api/pipeline/[runId]/approve
 * Called when user approves the tool list on the review page.
 * Submits enrichment to Parallel.ai, transitions status to 'enriching'.
 * Returns { enrichmentRunId }.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { submitEnrichmentToParallel } from "@/src/services/enrichment";
import { saveApprovedToolsAndEnrichment } from "@/lib/pipeline-store";
import type { ToolCandidate } from "@/src/types";
import { log, elapsed } from "@/lib/logger";

export async function POST(
  req: NextRequest,
  { params }: { params: { runId: string } }
) {
  const t = Date.now();
  const { runId } = params;

  try {
    const body = (await req.json()) as { approvedTools: ToolCandidate[] };
    const { approvedTools } = body;

    if (!runId || !approvedTools?.length) {
      return NextResponse.json(
        { error: "runId and approvedTools are required" },
        { status: 400 }
      );
    }

    // Load keyword from pipeline run
    const { data: run, error: runError } = await supabase
      .from("pipeline_runs")
      .select("keyword")
      .eq("run_id", runId)
      .single();

    if (runError || !run) {
      return NextResponse.json(
        { error: runError?.message ?? "Run not found" },
        { status: 404 }
      );
    }

    const keyword = run.keyword as string;

    log.info("api/pipeline/approve", "start", {
      runId,
      keyword,
      toolCount: approvedTools.length,
    });

    // Insert enrichment job row
    const { error: insertError } = await supabase.from("enrichment_jobs").insert({
      run_id: runId,
      keyword,
      tool_count: approvedTools.length,
      tool_names: approvedTools.map((t) => t.name),
      status: "pending",
    });

    if (insertError) {
      log.error("api/pipeline/approve", "enrichment_jobs insert failed", {
        error: insertError.message,
        runId,
      });
      return NextResponse.json(
        { error: `DB error: ${insertError.message}` },
        { status: 500 }
      );
    }

    // Submit to Parallel.ai (fire and forget — results come via polling)
    const submission = await submitEnrichmentToParallel(approvedTools, keyword, runId);

    if (submission) {
      await supabase
        .from("enrichment_jobs")
        .update({
          parallel_group_id: submission.groupId,
          parallel_run_ids: submission.runIds,
          status: "processing",
        })
        .eq("run_id", runId);
    } else {
      await supabase
        .from("enrichment_jobs")
        .update({ status: "failed", error: "Parallel.ai submission failed" })
        .eq("run_id", runId);
    }

    // Update pipeline_runs: approved tools + enrichment run id + status → enriching
    await saveApprovedToolsAndEnrichment(runId, approvedTools, runId);

    log.info("api/pipeline/approve", "complete", {
      runId,
      ms: elapsed(t),
      parallelGroupId: submission?.groupId ?? null,
      runCount: submission?.runIds?.length ?? 0,
      enrichmentStatus: submission ? "processing" : "failed",
    });

    return NextResponse.json({
      enrichmentRunId: runId,
      parallelGroupId: submission?.groupId ?? null,
      status: submission ? "enriching" : "enrichment_failed",
    });
  } catch (err) {
    log.error("api/pipeline/approve", "failed", {
      runId,
      ms: elapsed(t),
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Approve failed" },
      { status: 500 }
    );
  }
}
