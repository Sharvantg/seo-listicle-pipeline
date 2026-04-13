/**
 * POST /api/pipeline/[runId]/run
 * SSE stream: drives generation → eval → [revise → eval] loop → complete.
 * Frontend subscribes using fetch + ReadableStream.
 */

import { NextRequest } from "next/server";
import { runPipelinePhase } from "@/src/pipeline/runner";
import type { PipelineEvent } from "@/src/pipeline/runner";
import { log } from "@/lib/logger";

export const maxDuration = 300; // 5-minute timeout (Vercel Pro)

export async function POST(
  _req: NextRequest,
  { params }: { params: { runId: string } }
) {
  const { runId } = params;

  if (!runId) {
    return new Response(JSON.stringify({ error: "runId is required" }), { status: 400 });
  }

  log.info("api/pipeline/run", "SSE stream started", { runId });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (data: PipelineEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Controller may be closed if client disconnected
        }
      };

      try {
        await runPipelinePhase(runId, emit);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        log.error("api/pipeline/run", "runPipelinePhase threw", { runId, error: msg });
        emit({ type: "error", message: msg });
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
