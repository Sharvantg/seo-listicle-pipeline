"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Download, ExternalLink, Send, AlertCircle } from "lucide-react";
import type { EvalResult, GeneratedDraft } from "@/src/types";

interface Props {
  draft: GeneratedDraft;
  evalResult: EvalResult;
  pipelineRunId?: string;
}

export default function OutputPreview({ draft, evalResult, pipelineRunId }: Props) {
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState("");
  const [webflowUrl, setWebflowUrl] = useState("");

  async function handlePublish() {
    if (evalResult.flaggedForReview || !pipelineRunId) return;

    setPublishing(true);
    setPublishError("");

    try {
      const res = await fetch(`/api/pipeline/${pipelineRunId}/publish`, {
        method: "POST",
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      const result = await res.json();
      setWebflowUrl(result.editUrl);
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : "Publish failed");
    } finally {
      setPublishing(false);
    }
  }

  function handleDownload() {
    const blob = new Blob([draft.content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${draft.slug}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      {/* Metadata strip */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Title: </span>
              <span className="font-medium">{draft.title}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Slug: </span>
              <code className="bg-muted px-1 rounded text-xs">{draft.slug}</code>
            </div>
            <div>
              <span className="text-muted-foreground">Words: </span>
              <Badge variant="secondary">{draft.wordCount.toLocaleString()}</Badge>
            </div>
            <div>
              <span className="text-muted-foreground">KW Density: </span>
              <Badge
                variant={
                  draft.primaryKwDensity >= 0.01 && draft.primaryKwDensity <= 0.02
                    ? "success"
                    : "warning"
                }
              >
                {(draft.primaryKwDensity * 100).toFixed(2)}%
              </Badge>
            </div>
          </div>
          <div className="mt-2">
            <span className="text-muted-foreground text-xs">Meta: </span>
            <span className="text-xs">{draft.metaDescription}</span>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex gap-3 flex-wrap">
        <Button variant="outline" onClick={handleDownload}>
          <Download className="h-4 w-4 mr-2" />
          Download .md
        </Button>

        {!webflowUrl ? (
          <Button
            onClick={handlePublish}
            disabled={publishing || evalResult.flaggedForReview}
            className="relative"
          >
            {publishing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Pushing to Webflow...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Push to Webflow (Draft)
              </>
            )}
          </Button>
        ) : (
          <Button asChild variant="outline">
            <a href={webflowUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4 mr-2" />
              Open in Webflow Editor
            </a>
          </Button>
        )}
      </div>

      {evalResult.flaggedForReview && (
        <div className="rounded-md bg-yellow-50 border border-yellow-200 p-3 flex gap-2 text-sm">
          <AlertCircle className="h-4 w-4 text-yellow-600 flex-shrink-0 mt-0.5" />
          <p className="text-yellow-800">
            Publishing is blocked: article scored below 90 after 2 revision attempts.
            Download the draft, fix the flagged issues, then publish manually.
          </p>
        </div>
      )}

      {publishError && (
        <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-800">
          {publishError}
        </div>
      )}

      {/* Article preview */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Article Preview</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="prose prose-sm max-w-none">
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground bg-muted/30 p-4 rounded-lg overflow-auto max-h-[600px]">
              {draft.content}
            </pre>
          </div>
        </CardContent>
      </Card>

      {/* Schema preview */}
      {draft.jsonLd && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">JSON-LD Schema</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap font-mono text-xs bg-muted p-3 rounded-lg overflow-auto max-h-[200px]">
              {draft.jsonLd}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
