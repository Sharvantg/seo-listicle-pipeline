"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import RunOutput from "@/components/RunOutput";
import type { EvalResult, GeneratedDraft, PipelineInput, ResearchSynthesis, ToolData } from "@/src/types";

interface RunData {
  run_id: string;
  status: string;
  keyword: string;
  input: PipelineInput;
  research: ResearchSynthesis;
  final_draft: GeneratedDraft;
  enrichedTools: ToolData[];
  eval_score: number;
  eval_passed: boolean;
  eval_flagged: boolean;
  eval_retry_count: number;
  eval_metrics: EvalResult["metrics"];
  webflow_item_id?: string;
  webflow_edit_url?: string;
}

export default function OutputByRunIdPage() {
  const { runId } = useParams<{ runId: string }>();
  const router = useRouter();
  const [run, setRun] = useState<RunData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) return;
    fetch(`/api/pipeline/${runId}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Run not found (${res.status})`);
        return res.json();
      })
      .then((data: RunData) => {
        if (data.status !== "complete" || !data.final_draft) {
          localStorage.setItem("pipelineRunId", data.run_id);
          router.push("/generating");
          return;
        }
        setRun(data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, [runId, router]);

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <p className="text-destructive">{error}</p>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-1/3" />
          <div className="h-64 bg-muted rounded" />
        </div>
      </div>
    );
  }

  return (
    <RunOutput
      runId={run.run_id}
      input={run.input}
      research={run.research}
      enrichedTools={run.enrichedTools ?? []}
      draft={run.final_draft}
      evalResult={{
        overallScore: run.eval_score ?? 0,
        passed: run.eval_passed ?? false,
        metrics: run.eval_metrics ?? [],
        retryComments: "",
        retryCount: run.eval_retry_count ?? 0,
        flaggedForReview: run.eval_flagged ?? false,
      }}
      webflowItemId={run.webflow_item_id}
      webflowEditUrl={run.webflow_edit_url}
    />
  );
}
