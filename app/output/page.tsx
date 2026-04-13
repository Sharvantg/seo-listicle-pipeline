"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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

export default function OutputPage() {
  const router = useRouter();
  const [run, setRun] = useState<RunData | null>(null);

  useEffect(() => {
    const runId = localStorage.getItem("pipelineRunId");
    if (!runId) { router.push("/"); return; }

    fetch(`/api/pipeline/${runId}`)
      .then((res) => {
        if (!res.ok) { router.push("/"); return null; }
        return res.json();
      })
      .then((data: RunData | null) => {
        if (!data) return;
        if (data.status !== "complete" || !data.final_draft) {
          router.push("/generating");
          return;
        }
        setRun(data);
      })
      .catch(() => router.push("/"));
  }, [router]);

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
