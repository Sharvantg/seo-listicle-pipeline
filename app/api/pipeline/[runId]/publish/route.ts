/**
 * POST /api/pipeline/[runId]/publish
 * Reads the final draft from Supabase, pushes to Webflow CMS as a draft.
 * No draft in request body — always reads from DB to ensure consistency.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { publishToWebflow } from "@/src/integrations/webflow";
import { updateWebflowDetails } from "@/lib/pipeline-store";
import type { GeneratedDraft } from "@/src/types";
import { log, elapsed } from "@/lib/logger";

export async function POST(
  _req: NextRequest,
  { params }: { params: { runId: string } }
) {
  const t = Date.now();
  const { runId } = params;

  try {
    // Load draft from Supabase
    const { data: run, error } = await supabase
      .from("pipeline_runs")
      .select("final_draft, eval_flagged, keyword")
      .eq("run_id", runId)
      .single();

    if (error || !run) {
      return NextResponse.json(
        { error: error?.message ?? "Run not found" },
        { status: 404 }
      );
    }

    if (run.eval_flagged) {
      return NextResponse.json(
        { error: "Article is flagged for review — cannot publish automatically" },
        { status: 422 }
      );
    }

    if (!run.final_draft) {
      return NextResponse.json(
        { error: "No final draft found for this run" },
        { status: 422 }
      );
    }

    const draft = run.final_draft as unknown as GeneratedDraft;

    log.info("api/pipeline/publish", "start", {
      runId,
      title: draft.title,
      slug: draft.slug,
      wordCount: draft.wordCount,
    });

    const result = await publishToWebflow(draft);

    log.info("api/pipeline/publish", "Webflow publish complete", {
      ms: elapsed(t),
      itemId: result.itemId,
      editUrl: result.editUrl,
    });

    // Save Webflow link to run trace (fire-and-forget)
    updateWebflowDetails(runId, result.itemId, result.editUrl).catch((err) =>
      log.warn("api/pipeline/publish", "Webflow trace save failed", {
        error: err instanceof Error ? err.message : String(err),
        runId,
      })
    );

    return NextResponse.json(result);
  } catch (err) {
    log.error("api/pipeline/publish", "Webflow publish failed", {
      ms: elapsed(t),
      runId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Webflow publish failed" },
      { status: 500 }
    );
  }
}
