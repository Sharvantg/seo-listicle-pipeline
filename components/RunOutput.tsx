"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, ExternalLink } from "lucide-react";
import EvalScorecard from "@/components/EvalScorecard";
import OutputPreview from "@/components/OutputPreview";
import type {
  PipelineInput,
  ResearchSynthesis,
  ToolData,
  GeneratedDraft,
  EvalResult,
} from "@/src/types";

interface RunOutputProps {
  runId: string;
  input: PipelineInput;
  research: ResearchSynthesis;
  enrichedTools: ToolData[];
  draft: GeneratedDraft;
  evalResult: EvalResult;
  webflowItemId?: string;
  webflowEditUrl?: string;
}

type Tab = "research" | "tools" | "article";

export default function RunOutput({
  runId,
  input,
  research,
  enrichedTools,
  draft,
  evalResult,
  webflowItemId,
  webflowEditUrl,
}: RunOutputProps) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("research");

  const kw = research.keywordData;
  const serp = research.serpInsights;
  const aeo = research.citationSources;

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold">Pipeline Output</h1>
            <Badge variant="secondary">Complete</Badge>
            <Badge variant={evalResult.passed ? "default" : "destructive"}>
              {evalResult.overallScore}/100
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            Keyword: <strong>{input.primaryKeyword}</strong> · {draft.wordCount.toLocaleString()} words · {enrichedTools.length} tools · {evalResult.retryCount} revision{evalResult.retryCount !== 1 ? "s" : ""}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => router.push("/")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> New article
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b">
        {(["research", "tools", "article"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${
              tab === t
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "tools" ? `Tool Intelligence (${enrichedTools.length})` : t === "article" ? "Article" : "Research"}
          </button>
        ))}
      </div>

      {/* ── Research tab ── */}
      {tab === "research" && (
        <div className="space-y-6">
          {/* Keyword stats */}
          <Card className="p-5">
            <h2 className="font-semibold mb-4">Keyword Intelligence</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
              <Stat label="KW Difficulty" value={`${kw.difficulty}/100`} color={difficultyColor(kw.difficulty)} />
              <Stat label="Monthly Volume" value={kw.volume.toLocaleString()} />
              <Stat label="Intent" value={kw.intent} />
              <Stat label="Opportunity" value={`${kw.opportunity}/100`} color={opportunityColor(kw.opportunity)} />
            </div>

            {kw.relatedKeywords.length > 0 && (
              <>
                <Separator className="my-4" />
                <h3 className="text-sm font-medium mb-3 text-muted-foreground uppercase tracking-wide">Related Keywords</h3>
                <div className="space-y-1">
                  {kw.relatedKeywords.slice(0, 8).map((rk) => (
                    <div key={rk.keyword} className="flex items-center justify-between text-sm py-1">
                      <span>{rk.keyword}</span>
                      <div className="flex gap-4 text-muted-foreground">
                        <span>Vol: {rk.volume.toLocaleString()}</span>
                        <span>KD: {rk.difficulty}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Card>

          {/* Content gaps */}
          {research.contentGaps.length > 0 && (
            <Card className="p-5">
              <h2 className="font-semibold mb-3">Content Gaps to Fill</h2>
              <ul className="space-y-2">
                {research.contentGaps.map((gap, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className="text-muted-foreground mt-0.5">→</span>
                    {gap}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* AEO / Citation intelligence */}
          <Card className="p-5">
            <h2 className="font-semibold mb-1">AEO — AI Answer Intelligence</h2>
            <p className="text-xs text-muted-foreground mb-4">Tools Claude & GPT-4 already recommend for this keyword — write content that positions Zuddl alongside these.</p>

            {aeo.consensusTools.length > 0 && (
              <>
                <h3 className="text-sm font-medium mb-2">Consensus Tools (both models agree)</h3>
                <div className="flex flex-wrap gap-2 mb-4">
                  {aeo.consensusTools.map((t) => (
                    <Badge key={t} variant="secondary">{t}</Badge>
                  ))}
                </div>
              </>
            )}

            {aeo.aiInsights.map((insight) => (
              <div key={insight.model} className="mb-4">
                <h3 className="text-sm font-medium mb-2 text-muted-foreground">{insight.model}</h3>
                {insight.toolsMentioned.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {insight.toolsMentioned.slice(0, 8).map((t) => (
                      <span key={t.name} className="text-xs bg-muted px-2 py-0.5 rounded">
                        #{t.rank} {t.name}
                      </span>
                    ))}
                  </div>
                )}
                {insight.keyInsights.length > 0 && (
                  <ul className="space-y-1 mt-2">
                    {insight.keyInsights.slice(0, 3).map((ins, i) => (
                      <li key={i} className="text-xs text-muted-foreground">· {ins}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}

            {aeo.domains.length > 0 && (
              <>
                <Separator className="my-3" />
                <h3 className="text-sm font-medium mb-2">Authority Sources Referenced</h3>
                <div className="flex flex-wrap gap-2">
                  {aeo.domains.map((d) => (
                    <Badge key={d} variant="outline" className="text-xs">{d}</Badge>
                  ))}
                </div>
              </>
            )}
          </Card>

          {/* SERP top results */}
          {serp.topResults.length > 0 && (
            <Card className="p-5">
              <h2 className="font-semibold mb-3">Top SERP Results</h2>
              <div className="space-y-3">
                {serp.topResults.slice(0, 5).map((r) => (
                  <div key={r.url} className="text-sm">
                    <div className="flex items-start gap-2">
                      <span className="text-muted-foreground w-4 shrink-0">#{r.position}</span>
                      <div>
                        <a href={r.url} target="_blank" rel="noopener noreferrer"
                          className="font-medium hover:underline text-blue-600 dark:text-blue-400 flex items-center gap-1">
                          {r.title} <ExternalLink className="h-3 w-3" />
                        </a>
                        <p className="text-muted-foreground text-xs mt-0.5">{r.snippet}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {serp.commonTopics.length > 0 && (
                <>
                  <Separator className="my-4" />
                  <h3 className="text-sm font-medium mb-2">Common Topics Across Results</h3>
                  <div className="flex flex-wrap gap-2">
                    {serp.commonTopics.map((t) => (
                      <Badge key={t} variant="outline" className="text-xs">{t}</Badge>
                    ))}
                  </div>
                </>
              )}
            </Card>
          )}
        </div>
      )}

      {/* ── Tool Intelligence tab ── */}
      {tab === "tools" && (
        <div className="space-y-4">
          {enrichedTools.length === 0 ? (
            <p className="text-muted-foreground text-sm">No enrichment data available.</p>
          ) : (
            enrichedTools.map((tool) => (
              <Card key={tool.name} className="p-5">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <h3 className="font-semibold text-lg">{tool.name}</h3>
                      {tool.website && (
                        <a href={tool.website} target="_blank" rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-foreground">
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      )}
                    </div>
                    {tool.tagline && <p className="text-sm text-muted-foreground">{tool.tagline}</p>}
                  </div>
                  <div className="text-right shrink-0 space-y-1">
                    {tool.g2Rating && tool.g2Rating !== "N/A" && (
                      <div className="text-xs"><span className="text-muted-foreground">G2 </span><strong>{tool.g2Rating}</strong></div>
                    )}
                    {tool.capteraRating && tool.capteraRating !== "N/A" && (
                      <div className="text-xs"><span className="text-muted-foreground">Capterra </span><strong>{tool.capteraRating}</strong></div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                  {tool.bestFor && (
                    <div>
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Best For</span>
                      <p className="mt-1">{tool.bestFor}</p>
                    </div>
                  )}

                  <div>
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Pricing</span>
                    <p className="mt-1">
                      {tool.pricing}
                      {tool.pricingUrl && (
                        <a href={tool.pricingUrl} target="_blank" rel="noopener noreferrer"
                          className="ml-2 text-xs text-blue-600 hover:underline">
                          See pricing →
                        </a>
                      )}
                    </p>
                  </div>

                  {tool.strengths.length > 0 && (
                    <div>
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Strengths</span>
                      <ul className="mt-1 space-y-0.5">
                        {tool.strengths.map((s, i) => (
                          <li key={i} className="flex items-start gap-1">
                            <span className="text-green-600 mt-0.5">+</span> {s}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {tool.gaps.length > 0 && (
                    <div>
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Limitations</span>
                      <ul className="mt-1 space-y-0.5">
                        {tool.gaps.map((g, i) => (
                          <li key={i} className="flex items-start gap-1">
                            <span className="text-red-500 mt-0.5">−</span> {g}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                {tool.notableCustomers.length > 0 && (
                  <div className="mt-3 pt-3 border-t">
                    <span className="text-xs text-muted-foreground">Notable customers: </span>
                    <span className="text-sm">{tool.notableCustomers.join(", ")}</span>
                  </div>
                )}
              </Card>
            ))
          )}
        </div>
      )}

      {/* ── Article tab ── */}
      {tab === "article" && (
        <div className="space-y-6">
          <EvalScorecard evalResult={evalResult} />
          <OutputPreview
            draft={draft}
            evalResult={evalResult}
            pipelineRunId={runId}
          />
        </div>
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className={`text-xl font-bold ${color ?? ""}`}>{value}</p>
    </div>
  );
}

function difficultyColor(d: number): string {
  if (d <= 30) return "text-green-600";
  if (d <= 60) return "text-yellow-600";
  return "text-red-600";
}

function opportunityColor(o: number): string {
  if (o >= 70) return "text-green-600";
  if (o >= 40) return "text-yellow-600";
  return "text-red-600";
}
