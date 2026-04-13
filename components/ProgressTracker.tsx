"use client";

import { CheckCircle, Loader2, Clock, AlertCircle } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import type { StageStatus } from "@/src/types";

interface Props {
  stages: StageStatus[];
  evalScore?: number;
  retryCount?: number;
}

export default function ProgressTracker({ stages, evalScore, retryCount = 0 }: Props) {
  const completedCount = stages.filter((s) => s.status === "complete").length;
  const progressPct = Math.round((completedCount / stages.length) * 100);
  const currentStage = stages.find((s) => s.status === "in_progress");
  const hasError = stages.some((s) => s.status === "error");

  return (
    <div className="space-y-6">
      {/* Overall progress bar */}
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Overall progress</span>
          <span className="font-medium">{progressPct}%</span>
        </div>
        <Progress value={progressPct} className="h-2" />
      </div>

      {/* Stage list */}
      <div className="space-y-3">
        {stages.map((stage, i) => (
          <StageRow key={stage.stage} stage={stage} index={i} />
        ))}
      </div>

      {/* Eval info */}
      {evalScore !== undefined && (
        <div className="rounded-lg border p-4 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Quality Score</span>
            <span
              className={`text-2xl font-bold ${
                evalScore >= 90
                  ? "text-green-600"
                  : evalScore >= 70
                  ? "text-yellow-600"
                  : "text-red-600"
              }`}
            >
              {evalScore}/100
            </span>
          </div>
          {retryCount > 0 && (
            <p className="text-xs text-muted-foreground">
              Retry {retryCount}/2 — Claude is revising the article...
            </p>
          )}
          {evalScore >= 90 && (
            <Badge variant="success" className="text-xs">Passed quality threshold</Badge>
          )}
        </div>
      )}

      {/* Current action label */}
      {currentStage && !hasError && (
        <p className="text-center text-sm text-muted-foreground animate-pulse">
          {currentStage.detail ?? `${currentStage.label}...`}
        </p>
      )}
    </div>
  );
}

function StageRow({ stage, index }: { stage: StageStatus; index: number }) {
  const icon = {
    pending: <Clock className="h-4 w-4 text-muted-foreground" />,
    in_progress: <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />,
    complete: <CheckCircle className="h-4 w-4 text-green-500" />,
    error: <AlertCircle className="h-4 w-4 text-destructive" />,
  }[stage.status];

  return (
    <div
      className={`flex items-center gap-3 p-3 rounded-lg transition-colors ${
        stage.status === "in_progress" ? "bg-blue-50 border border-blue-100" : ""
      } ${stage.status === "error" ? "bg-red-50 border border-red-100" : ""}`}
    >
      <div className="flex-shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <p
          className={`text-sm font-medium ${
            stage.status === "pending" ? "text-muted-foreground" : "text-foreground"
          }`}
        >
          {stage.label}
        </p>
        {stage.detail && stage.status !== "pending" && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{stage.detail}</p>
        )}
      </div>
      <span className="text-xs text-muted-foreground font-mono">{index + 1}</span>
    </div>
  );
}
