"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ProgressTracker from "@/components/ProgressTracker";
import { Badge } from "@/components/ui/badge";
import type {
  EvalResult,
  GeneratedDraft,
  PipelineState,
  StageStatus,
} from "@/src/types";
import type { PipelineEvent } from "@/src/pipeline/runner";

const INITIAL_STAGES: StageStatus[] = [
  { stage: "enriching", label: "Enriching tool data (Parallel.ai)", status: "pending" },
  { stage: "generating", label: "Generating article draft", status: "pending" },
  { stage: "evaluating", label: "Evaluating quality", status: "pending" },
  { stage: "complete", label: "Complete", status: "pending" },
];

const ENRICH_POLL_INTERVAL_MS = 30_000;

export default function GeneratingPage() {
  const router = useRouter();
  const [runId, setRunId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState<string>("");
  const [toolCount, setToolCount] = useState<number>(0);
  const [stages, setStages] = useState<StageStatus[]>(INITIAL_STAGES);
  const [evalScore, setEvalScore] = useState<number | undefined>();
  const [retryCount, setRetryCount] = useState(0);
  const [error, setError] = useState("");
  const started = useRef(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate runId from sessionStorage or localStorage
  useEffect(() => {
    let id: string | null = null;
    let kw = "";
    let tc = 0;

    // Try sessionStorage first (fast)
    const cached = sessionStorage.getItem("pipelineState");
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as PipelineState;
        id = parsed.pipelineRunId ?? null;
        kw = parsed.input?.primaryKeyword ?? "";
        tc = parsed.approvedTools?.length ?? 0;
      } catch {
        // Fall through
      }
    }

    // Fallback to localStorage
    if (!id) {
      id = localStorage.getItem("pipelineRunId");
    }

    if (!id) {
      router.push("/");
      return;
    }

    setRunId(id);
    setKeyword(kw);
    setToolCount(tc);
  }, [router]);

  // Once we have runId, check status and start the appropriate flow
  useEffect(() => {
    if (!runId || started.current) return;
    started.current = true;

    checkStatusAndStart(runId);
  }, [runId]); // eslint-disable-line react-hooks/exhaustive-deps

  function updateStage(stageName: string, update: Partial<StageStatus>) {
    setStages((prev) =>
      prev.map((s) => (s.stage === stageName ? { ...s, ...update } : s))
    );
  }

  async function checkStatusAndStart(id: string) {
    try {
      const res = await fetch(`/api/pipeline/${id}`);
      if (!res.ok) {
        setError("Could not load pipeline run. Please start over.");
        return;
      }

      const run = await res.json();
      const status = run.status as string;

      // Update keyword/toolCount from DB if not set
      if (!keyword && run.input?.primaryKeyword) setKeyword(run.input.primaryKeyword);
      if (!toolCount && run.approved_tools?.length) setToolCount(run.approved_tools.length);

      if (status === "complete") {
        // Already done — load from DB and go to output
        const pipelineState: PipelineState = {
          input: run.input,
          draft: run.final_draft as GeneratedDraft,
          evalResult: buildEvalResult(run),
          currentStage: "complete",
          pipelineRunId: id,
        };
        sessionStorage.setItem("pipelineState", JSON.stringify(pipelineState));
        router.push(`/output/${id}`);
        return;
      }

      if (status === "enriching") {
        // Enrichment still running — poll until ready_to_generate
        updateStage("enriching", {
          status: "in_progress",
          detail: "Waiting for Parallel.ai research to complete…",
        });
        pollForEnrichment(id);
        return;
      }

      if (
        status === "ready_to_generate" ||
        status === "generating" ||
        status === "evaluating" ||
        status === "revising"
      ) {
        // Resume or start the generation SSE stream
        updateStage("enriching", { status: "complete", detail: "Tool data ready" });
        await startStream(id);
        return;
      }

      if (status === "error") {
        setError(run.error ?? "Pipeline failed. Please start over.");
        return;
      }

      // Unexpected status
      setError(`Unexpected pipeline status: ${status}. Please start over.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load pipeline state");
    }
  }

  function pollForEnrichment(id: string) {
    pollTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/pipeline/${id}`);
        if (!res.ok) {
          pollForEnrichment(id); // retry
          return;
        }

        const run = await res.json();
        const status = run.status as string;

        if (status === "ready_to_generate") {
          updateStage("enriching", { status: "complete", detail: "Tool data ready" });
          await startStream(id);
        } else if (status === "enriching") {
          const elapsed = Date.now() - new Date(run.created_at).getTime();
          const elapsedMin = Math.round(elapsed / 60000);
          updateStage("enriching", {
            status: "in_progress",
            detail: elapsedMin > 0
              ? `Parallel.ai researching tools… ${elapsedMin} min elapsed`
              : `Parallel.ai researching ${run.approved_tools?.length ?? "?"} tools…`,
          });
          pollForEnrichment(id);
        } else if (status === "complete") {
          const pipelineState: PipelineState = {
            input: run.input,
            draft: run.final_draft as GeneratedDraft,
            evalResult: buildEvalResult(run),
            currentStage: "complete",
            pipelineRunId: id,
          };
          sessionStorage.setItem("pipelineState", JSON.stringify(pipelineState));
          router.push(`/output/${id}`);
        } else if (status === "error") {
          setError(run.error ?? "Enrichment failed");
          updateStage("enriching", { status: "error", detail: "Enrichment failed" });
        } else {
          // Any other status (generating, etc.) — start stream
          updateStage("enriching", { status: "complete", detail: "Tool data ready" });
          await startStream(id);
        }
      } catch {
        pollForEnrichment(id); // retry silently
      }
    }, ENRICH_POLL_INTERVAL_MS);
  }

  async function startStream(id: string) {
    updateStage("generating", { status: "in_progress", detail: "Writing article…" });

    try {
      const res = await fetch(`/api/pipeline/${id}/run`, { method: "POST" });

      if (!res.ok || !res.body) {
        throw new Error(`Stream failed: ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? ""; // keep incomplete line in buffer

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6)) as PipelineEvent;
            handleEvent(id, event);
          } catch {
            // Skip malformed event
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Stream error";
      setError(msg);
      setStages((prev) =>
        prev.map((s) => (s.status === "in_progress" ? { ...s, status: "error", detail: msg } : s))
      );
    }
  }

  function handleEvent(id: string, event: PipelineEvent) {
    switch (event.type) {
      case "generating":
        updateStage("generating", { status: "in_progress", detail: event.detail });
        break;

      case "generating_done":
        updateStage("generating", {
          status: "complete",
          detail: `${event.wordCount.toLocaleString()} words generated`,
        });
        break;

      case "evaluating":
        updateStage("evaluating", {
          status: "in_progress",
          detail: event.round === 0 ? "Running quality checks…" : `Re-evaluating after revision ${event.round}…`,
        });
        break;

      case "eval_done":
        setEvalScore(event.score);
        if (event.passed) {
          updateStage("evaluating", {
            status: "complete",
            detail: `Score: ${event.score}/100 — passed`,
          });
        } else {
          updateStage("evaluating", {
            status: "in_progress",
            detail: `Score ${event.score}/100 — needs revision`,
          });
        }
        break;

      case "revising":
        setRetryCount(event.round + 1);
        updateStage("evaluating", {
          status: "in_progress",
          detail: `Applying fixes (round ${event.round + 1}/3)…`,
        });
        break;

      case "complete": {
        const { draft, evalResult } = event;
        const flagged = evalResult.flaggedForReview;

        updateStage("evaluating", {
          status: flagged ? "error" : "complete",
          detail: `Score: ${evalResult.overallScore}/100${flagged ? " — flagged for review" : ""}`,
        });
        updateStage("complete", { status: "complete" });

        // Persist to sessionStorage and navigate
        const cachedStr = sessionStorage.getItem("pipelineState");
        const cached = cachedStr ? (JSON.parse(cachedStr) as PipelineState) : null;

        const pipelineState: PipelineState = {
          input: cached?.input ?? { primaryKeyword: keyword, secondaryKeywords: [], toolCount },
          research: cached?.research,
          approvedTools: cached?.approvedTools,
          draft,
          evalResult,
          currentStage: "complete",
          pipelineRunId: id,
        };

        sessionStorage.setItem("pipelineState", JSON.stringify(pipelineState));
        setTimeout(() => router.push(`/output/${id}`), 800);
        break;
      }

      case "error":
        setError(event.message);
        setStages((prev) =>
          prev.map((s) => (s.status === "in_progress" ? { ...s, status: "error", detail: event.message } : s))
        );
        break;
    }
  }

  // Cleanup poll timer on unmount
  useEffect(() => {
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, []);

  if (!runId) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-1/3" />
          <div className="h-64 bg-muted rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <h2 className="text-2xl font-bold">Generating Article</h2>
          <Badge variant="secondary">Step 3 of 4</Badge>
        </div>
        {keyword && (
          <p className="text-muted-foreground">
            For: <strong>{keyword}</strong>{toolCount > 0 ? ` · ${toolCount} tools` : ""}
          </p>
        )}
        <p className="text-xs text-muted-foreground mt-1">
          Run ID: <code className="bg-muted px-1 rounded">{runId}</code>
        </p>
      </div>

      <ProgressTracker
        stages={stages}
        evalScore={evalScore}
        retryCount={retryCount}
      />

      {stages[0].status === "in_progress" && (
        <div className="mt-4 rounded-lg border bg-blue-50 border-blue-100 p-4 text-sm text-blue-800">
          <strong>Parallel.ai is researching each tool in depth.</strong>
          <br />
          This typically takes 10–20 minutes. You can close this tab and come back —
          the page will automatically resume when research is complete.
        </div>
      )}

      {error && (
        <div className="mt-6 rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-800">
          <strong>Error:</strong> {error}
          <br />
          <a href="/" className="underline mt-1 inline-block">
            Start over
          </a>
        </div>
      )}
    </div>
  );
}

// ─── Helper ────────────────────────────────────────────────────────────────────

function buildEvalResult(run: Record<string, unknown>): EvalResult {
  return {
    overallScore: (run.eval_score as number) ?? 0,
    passed: (run.eval_passed as boolean) ?? false,
    metrics: (run.eval_metrics as EvalResult["metrics"]) ?? [],
    retryComments: "",
    retryCount: (run.eval_retry_count as number) ?? 0,
    flaggedForReview: (run.eval_flagged as boolean) ?? false,
    attempts: (run.eval_attempts as EvalResult["attempts"]) ?? [],
  };
}
