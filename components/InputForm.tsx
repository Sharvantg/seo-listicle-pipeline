"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { X, Plus, Loader2 } from "lucide-react";
import type { PipelineInput, PipelineState } from "@/src/types";

export default function InputForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [primaryKeyword, setPrimaryKeyword] = useState("");
  const [secondaryKeywords, setSecondaryKeywords] = useState<string[]>([]);
  const [kwInput, setKwInput] = useState("");
  const [toolCount, setToolCount] = useState(10);
  const [notes, setNotes] = useState("");

  function addKeyword() {
    const trimmed = kwInput.trim();
    if (trimmed && !secondaryKeywords.includes(trimmed)) {
      setSecondaryKeywords([...secondaryKeywords, trimmed]);
      setKwInput("");
    }
  }

  function removeKeyword(kw: string) {
    setSecondaryKeywords(secondaryKeywords.filter((k) => k !== kw));
  }

  function handleKwKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addKeyword();
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!primaryKeyword.trim()) {
      setError("Primary keyword is required.");
      return;
    }

    setLoading(true);

    const input: PipelineInput = {
      primaryKeyword: primaryKeyword.trim(),
      secondaryKeywords,
      toolCount,
      notes: notes.trim() || undefined,
    };

    try {
      // Single call to /api/pipeline — runs research + tool discovery, creates DB row
      const res = await fetch("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`API error: ${errText}`);
      }

      const { runId, research, toolCandidates } = await res.json();

      // Store runId in localStorage (survives browser close)
      localStorage.setItem("pipelineRunId", runId);

      // Cache full state in sessionStorage for fast page transitions
      const state: PipelineState = {
        input,
        research,
        toolCandidates,
        currentStage: "awaiting-review",
        pipelineRunId: runId,
      };
      sessionStorage.setItem("pipelineState", JSON.stringify(state));

      router.push("/review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Keyword Setup</CardTitle>
          <CardDescription>
            Define the target keywords for the listicle. Be specific — e.g. "event registration software" not just "event software".
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="primary-kw">Primary Keyword *</Label>
            <Input
              id="primary-kw"
              placeholder="e.g. event registration software"
              value={primaryKeyword}
              onChange={(e) => setPrimaryKeyword(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">
              This keyword drives title, meta, density targets, and SERP research.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Secondary Keywords</Label>
            <div className="flex gap-2">
              <Input
                placeholder="Add keyword and press Enter"
                value={kwInput}
                onChange={(e) => setKwInput(e.target.value)}
                onKeyDown={handleKwKeyDown}
              />
              <Button type="button" variant="outline" size="icon" onClick={addKeyword}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {secondaryKeywords.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {secondaryKeywords.map((kw) => (
                  <Badge key={kw} variant="secondary" className="gap-1">
                    {kw}
                    <button
                      type="button"
                      onClick={() => removeKeyword(kw)}
                      className="ml-1 hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Article Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Number of Tools to Include: {toolCount}</Label>
            <div className="flex items-center gap-4">
              <span className="text-sm text-muted-foreground">5</span>
              <input
                type="range"
                min={5}
                max={15}
                value={toolCount}
                onChange={(e) => setToolCount(Number(e.target.value))}
                className="flex-1 h-2 rounded-lg appearance-none cursor-pointer bg-secondary"
              />
              <span className="text-sm text-muted-foreground">15</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Editorial Notes (optional)</Label>
            <Textarea
              id="notes"
              placeholder="e.g. Focus on mid-market B2B buyers. Emphasize Salesforce integration. Avoid mentioning Hopin (competitor)."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Button type="submit" className="w-full" size="lg" disabled={loading}>
        {loading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Running research agents...
          </>
        ) : (
          "Run Research & Discover Tools →"
        )}
      </Button>

      {loading && (
        <p className="text-center text-sm text-muted-foreground">
          Running keyword analysis, SERP research, AEO citation check, and tool discovery in parallel. This takes ~20–30 seconds.
        </p>
      )}
    </form>
  );
}
