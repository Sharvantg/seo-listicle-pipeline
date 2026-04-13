"use client";

import { CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { EvalResult } from "@/src/types";

interface Props {
  evalResult: EvalResult;
}

export default function EvalScorecard({ evalResult }: Props) {
  const { overallScore, passed, metrics, retryCount, flaggedForReview } = evalResult;

  const scoreColor = overallScore >= 90
    ? "text-green-600"
    : overallScore >= 70
    ? "text-yellow-600"
    : "text-red-600";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Quality Scorecard</CardTitle>
          <div className="flex items-center gap-3">
            {flaggedForReview ? (
              <Badge variant="destructive">
                <AlertCircle className="h-3 w-3 mr-1" />
                Flagged for Manual Review
              </Badge>
            ) : passed ? (
              <Badge variant="success">
                <CheckCircle className="h-3 w-3 mr-1" />
                Passed
              </Badge>
            ) : (
              <Badge variant="warning">
                <XCircle className="h-3 w-3 mr-1" />
                Below Threshold
              </Badge>
            )}
            <span className={`text-4xl font-bold ${scoreColor}`}>{overallScore}</span>
            <span className="text-muted-foreground text-sm">/100</span>
          </div>
        </div>
        {retryCount > 0 && (
          <p className="text-sm text-muted-foreground mt-1">
            After {retryCount} revision{retryCount > 1 ? "s" : ""}
          </p>
        )}
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {metrics.map((m) => (
            <MetricRow key={m.metric} metric={m} />
          ))}
        </div>

        {flaggedForReview && (
          <div className="mt-4 rounded-md bg-red-50 border border-red-200 p-3">
            <div className="flex gap-2">
              <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-800">Manual review required</p>
                <p className="text-xs text-red-700 mt-0.5">
                  The article scored below 90 after 3 automated revision attempts. Review the
                  failed metrics above and edit the content before publishing.
                </p>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MetricRow({ metric }: { metric: EvalResult["metrics"][0] }) {
  const pct = Math.round((metric.score / metric.maxScore) * 100);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          {metric.passed ? (
            <CheckCircle className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
          ) : (
            <XCircle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />
          )}
          <span className="font-medium">{metric.metric}</span>
        </div>
        <span className="text-muted-foreground font-mono text-xs">
          {metric.score}/{metric.maxScore}
        </span>
      </div>
      <Progress
        value={pct}
        className={`h-1.5 ${metric.passed ? "[&>div]:bg-green-500" : "[&>div]:bg-red-400"}`}
      />
      <p className="text-xs text-muted-foreground pl-5">{metric.detail}</p>
    </div>
  );
}
