"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ToolReview from "@/components/ToolReview";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PipelineState, ResearchSynthesis, ToolCandidate } from "@/src/types";

export default function ReviewPage() {
  const router = useRouter();
  const [state, setState] = useState<PipelineState | null>(null);

  useEffect(() => {
    async function hydrate() {
      // 1. Try sessionStorage first (fast path)
      const cached = sessionStorage.getItem("pipelineState");
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as PipelineState;
          if (parsed.toolCandidates && parsed.pipelineRunId) {
            setState(parsed);
            return;
          }
        } catch {
          // Fall through to Supabase
        }
      }

      // 2. Fallback: load from Supabase via runId in localStorage
      const runId = localStorage.getItem("pipelineRunId");
      if (!runId) {
        router.push("/");
        return;
      }

      try {
        const res = await fetch(`/api/pipeline/${runId}`);
        if (!res.ok) {
          router.push("/");
          return;
        }

        const run = await res.json();

        // Route based on status
        if (run.status === "enriching" || run.status === "ready_to_generate" || run.status === "generating" || run.status === "evaluating" || run.status === "revising") {
          router.push("/generating");
          return;
        }
        if (run.status === "complete") {
          router.push("/output");
          return;
        }

        if (!run.tool_candidates) {
          router.push("/");
          return;
        }

        const restored: PipelineState = {
          input: run.input,
          research: run.research as ResearchSynthesis,
          toolCandidates: run.tool_candidates as ToolCandidate[],
          currentStage: "awaiting-review",
          pipelineRunId: run.run_id,
        };

        sessionStorage.setItem("pipelineState", JSON.stringify(restored));
        setState(restored);
      } catch {
        router.push("/");
      }
    }

    hydrate();
  }, [router]);

  if (!state) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-1/3" />
          <div className="h-64 bg-muted rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <h2 className="text-2xl font-bold">Review Tools</h2>
          <Badge variant="secondary">Step 2 of 4</Badge>
        </div>
        <p className="text-muted-foreground">
          For: <strong>{state.input.primaryKeyword}</strong>
        </p>
      </div>

      {/* Research summary */}
      {state.research && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Research Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">KW Difficulty</p>
                <p className="font-semibold text-lg">
                  {state.research.keywordData.difficulty}
                  <span className="text-xs text-muted-foreground font-normal">/100</span>
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Monthly Volume</p>
                <p className="font-semibold text-lg">
                  {state.research.keywordData.volume.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Intent</p>
                <p className="font-semibold capitalize">{state.research.keywordData.intent}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Top SERP Results</p>
                <p className="font-semibold">{state.research.serpInsights.topResults.length}</p>
              </div>
            </div>

            {state.research.contentGaps.length > 0 && (
              <div className="mt-3">
                <p className="text-xs text-muted-foreground mb-1">Content gaps to fill:</p>
                <div className="flex flex-wrap gap-1">
                  {state.research.contentGaps.map((gap) => (
                    <Badge key={gap} variant="outline" className="text-xs">
                      {gap}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {state.research.citationSources?.consensusTools?.length > 0 && (
              <div className="mt-3">
                <p className="text-xs text-muted-foreground mb-1">
                  AEO consensus — tools Claude & GPT-4 already recommend for this keyword:
                </p>
                <div className="flex flex-wrap gap-1">
                  {state.research.citationSources.consensusTools.map((tool) => (
                    <Badge key={tool} variant="secondary" className="text-xs">
                      {tool}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {state.research.citationSources?.aiInsights?.length > 0 && (
              <div className="mt-3 text-xs text-muted-foreground">
                AI models queried:{" "}
                {state.research.citationSources.aiInsights.map((i) => i.model).join(", ")}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <ToolReview state={state} onStateUpdate={setState} />
    </div>
  );
}
