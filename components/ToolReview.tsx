"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CheckCircle, XCircle, ChevronUp, ChevronDown, Plus, Loader2, ExternalLink } from "lucide-react";
import type { PipelineState, ToolCandidate } from "@/src/types";

interface Props {
  state: PipelineState;
  onStateUpdate: (state: PipelineState) => void;
}

export default function ToolReview({ state, onStateUpdate }: Props) {
  const router = useRouter();
  const [tools, setTools] = useState<ToolCandidate[]>(
    state.toolCandidates ?? []
  );
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [newToolName, setNewToolName] = useState("");
  const [newToolUrl, setNewToolUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const approvedTools = tools.filter((t) => !removed.has(t.name));

  function toggleRemove(name: string) {
    setRemoved((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function moveUp(index: number) {
    if (index === 0) return;
    const next = [...tools];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    setTools(next);
  }

  function moveDown(index: number) {
    if (index === tools.length - 1) return;
    const next = [...tools];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    setTools(next);
  }

  async function addTool() {
    const name = newToolName.trim();
    const website = newToolUrl.trim();

    if (!name || !website) {
      setError("Both tool name and website are required.");
      return;
    }

    const candidate: ToolCandidate = {
      name,
      website,
      confidence: 0.7,
      source: "manual",
      reason: "Added manually",
    };

    setTools([...tools, candidate]);
    setNewToolName("");
    setNewToolUrl("");
    setError("");
  }

  async function handleGenerate() {
    setLoading(true);
    setError("");

    if (approvedTools.length < 3) {
      setError("You need at least 3 approved tools to generate the article.");
      setLoading(false);
      return;
    }

    const runId = state.pipelineRunId;
    if (!runId) {
      setError("Missing run ID. Please start over from the home page.");
      setLoading(false);
      return;
    }

    try {
      // Approve tools + submit enrichment — single call
      const res = await fetch(`/api/pipeline/${runId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvedTools }),
      });

      if (!res.ok) {
        throw new Error(`Approval failed: ${await res.text()}`);
      }

      // Update sessionStorage with approved tools
      const updatedState: PipelineState = {
        ...state,
        toolCandidates: tools,
        approvedTools,
        currentStage: "enriching",
      };

      onStateUpdate(updatedState);
      sessionStorage.setItem("pipelineState", JSON.stringify(updatedState));
      router.push("/generating");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setLoading(false);
    }
  }

  const confidenceColor = (c: number) => {
    if (c >= 0.85) return "success";
    if (c >= 0.65) return "secondary";
    return "outline";
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Discovered Tools ({approvedTools.length} approved)</CardTitle>
          <CardDescription>
            Review, reorder, and approve the tools to include. Zuddl will always be positioned first.
            Drag or use arrows to reorder.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {tools.map((tool, i) => {
            const isRemoved = removed.has(tool.name);
            return (
              <div
                key={tool.name}
                className={`flex items-center gap-3 p-3 rounded-lg border transition-opacity ${
                  isRemoved ? "opacity-40 bg-muted" : "bg-card"
                }`}
              >
                {/* Order controls */}
                <div className="flex flex-col gap-0.5">
                  <button
                    onClick={() => moveUp(i)}
                    disabled={i === 0}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-20"
                  >
                    <ChevronUp className="h-3 w-3" />
                  </button>
                  <span className="text-xs text-center text-muted-foreground font-mono">
                    {i + 1}
                  </span>
                  <button
                    onClick={() => moveDown(i)}
                    disabled={i === tools.length - 1}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-20"
                  >
                    <ChevronDown className="h-3 w-3" />
                  </button>
                </div>

                {/* Tool info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{tool.name}</span>
                    <Badge variant={confidenceColor(tool.confidence) as "success" | "secondary" | "outline"} className="text-xs">
                      {Math.round(tool.confidence * 100)}% confidence
                    </Badge>
                    {tool.name.toLowerCase() === "zuddl" && (
                      <Badge variant="default" className="text-xs">Our pick</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <a
                      href={tool.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-muted-foreground hover:text-primary flex items-center gap-0.5"
                    >
                      {tool.website.replace(/^https?:\/\/(www\.)?/, "")}
                      <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </div>
                  {tool.reason && (
                    <p className="text-xs text-muted-foreground mt-0.5">{tool.reason}</p>
                  )}
                </div>

                {/* Toggle button */}
                <button
                  onClick={() => toggleRemove(tool.name)}
                  className={`flex-shrink-0 ${
                    isRemoved
                      ? "text-muted-foreground hover:text-foreground"
                      : "text-green-600 hover:text-destructive"
                  }`}
                >
                  {isRemoved ? (
                    <XCircle className="h-5 w-5" />
                  ) : (
                    <CheckCircle className="h-5 w-5" />
                  )}
                </button>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Add tool */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add a Tool</CardTitle>
          <CardDescription>
            Don&apos;t see a tool that should be included? Add it manually — it will be researched automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              placeholder="Tool name"
              value={newToolName}
              onChange={(e) => setNewToolName(e.target.value)}
              className="flex-1"
            />
            <Input
              placeholder="https://website.com"
              value={newToolUrl}
              onChange={(e) => setNewToolUrl(e.target.value)}
              className="flex-1"
            />
            <Button type="button" variant="outline" onClick={addTool}>
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {approvedTools.length} tools approved for the article
        </p>
        <Button
          onClick={handleGenerate}
          disabled={loading || approvedTools.length < 3}
          size="lg"
        >
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Submitting enrichment...
            </>
          ) : (
            "Generate Article →"
          )}
        </Button>
      </div>
    </div>
  );
}
