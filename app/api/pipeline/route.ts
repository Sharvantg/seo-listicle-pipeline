/**
 * POST /api/pipeline
 * Research phase: keyword service + SERP service + citation agent + tool discovery.
 * Creates a pipeline_runs row (status: awaiting_tool_review).
 * Returns { runId, research, toolCandidates }.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

export const maxDuration = 60;
import Anthropic from "@anthropic-ai/sdk";
import { runKeywordService } from "@/src/services/keyword";
import { runSerpService } from "@/src/services/serp";
import { runCitationAgent } from "@/src/agents/citation-agent";
import { runToolDiscoveryAgent } from "@/src/agents/tool-discovery-agent";
import { createPipelineRunFull } from "@/lib/pipeline-store";
import type { PipelineInput, ResearchSynthesis } from "@/src/types";
import { log, elapsed } from "@/lib/logger";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY! });

export async function POST(req: NextRequest) {
  const t = Date.now();
  let keyword = "(unknown)";

  try {
    const input = (await req.json()) as PipelineInput;
    keyword = input.primaryKeyword ?? "(unknown)";

    if (!input.primaryKeyword) {
      return NextResponse.json({ error: "primaryKeyword is required" }, { status: 400 });
    }

    log.info("api/pipeline", "start", {
      keyword,
      envCheck: {
        ANTHROPIC_KEY: process.env.ANTHROPIC_KEY ? `set(${process.env.ANTHROPIC_KEY.length}c)` : "MISSING",
        SERPER_API_KEY: process.env.SERPER_API_KEY ? "set" : "MISSING",
        MOZ_API_KEY: process.env.MOZ_API_KEY ? `set(${process.env.MOZ_API_KEY.length}c)` : "MISSING",
        VERCEL_AI_GATEWAY_KEY: process.env.VERCEL_AI_GATEWAY_KEY ? "set" : "MISSING",
      },
    });

    const query = input.primaryKeyword;
    const runId = randomUUID();

    // Run research + tool discovery in parallel
    const tAgents = Date.now();
    const [keywordData, serpInsights, citationSources, toolCandidates] = await Promise.all([
      runKeywordService(query),
      runSerpService(query),
      runCitationAgent(query),
      runToolDiscoveryAgent(query, input.toolCount ?? 10),
    ]);

    log.info("api/pipeline", "all agents complete", {
      ms: elapsed(tAgents),
      kwDifficulty: keywordData.difficulty,
      serpResultCount: serpInsights.topResults.length,
      consensusToolCount: citationSources.consensusTools.length,
      toolCandidateCount: toolCandidates.length,
    });

    // Claude analyzes actual SERP snippets to identify real content gaps
    const contentGaps = await deriveContentGaps(
      serpInsights.topResults.map((r) => r.snippet),
      query
    );

    // Link targets = union of SERP linked domains + AI-cited source names
    const aiSourceNames = citationSources.aiInsights
      .flatMap((i) => i.sourcesReferenced.map((s) => s.name))
      .filter((n) => !n.startsWith("http"));

    const linkTargets = Array.from(
      new Set([...serpInsights.linkedDomains, ...citationSources.domains, ...aiSourceNames])
    ).slice(0, 15);

    const research: ResearchSynthesis = {
      keywordData,
      serpInsights,
      citationSources,
      contentGaps,
      linkTargets,
      commonTools: citationSources.consensusTools,
    };

    // Create pipeline_runs row with research + tool candidates
    await createPipelineRunFull(runId, input, research, toolCandidates);

    log.info("api/pipeline", "complete", {
      ms: elapsed(t),
      keyword,
      runId,
      toolCandidateCount: toolCandidates.length,
    });

    return NextResponse.json({ runId, research, toolCandidates });
  } catch (err) {
    log.error("api/pipeline", "failed", {
      keyword,
      ms: elapsed(t),
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Research failed" },
      { status: 500 }
    );
  }
}

async function deriveContentGaps(snippets: string[], keyword: string): Promise<string[]> {
  if (snippets.length === 0) return [];

  const t = Date.now();
  const prompt = `Here are snippets from the top Google results for "${keyword}":

${snippets.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Identify 5 specific content gaps — topics or angles that are NOT adequately addressed in these results but would be valuable to someone evaluating ${keyword} options.

Return ONLY a JSON array of 5 short phrases (3-7 words each), no commentary:
["gap 1", "gap 2", "gap 3", "gap 4", "gap 5"]`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "[]";
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) {
      log.warn("api/pipeline", "content gap Claude response had no JSON array", { ms: elapsed(t) });
      return [];
    }

    return JSON.parse(match[0]) as string[];
  } catch (err) {
    log.warn("api/pipeline", "content gap analysis failed", {
      error: err instanceof Error ? err.message : String(err),
      ms: elapsed(t),
    });
    return [];
  }
}
