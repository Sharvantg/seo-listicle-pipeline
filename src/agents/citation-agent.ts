/**
 * Citation Agent — Answer Engine Optimization (AEO)
 *
 * Queries Claude and OpenAI (via Vercel AI Gateway) as a user would:
 * "What are the top 10 [keyword] in the US?"
 *
 * We parse each model's response for:
 * - Which tools they recommend (and in what order)
 * - Which sources/reports they reference (G2, Gartner, Capterra, etc.)
 * - Key facts/insights about the category they cite
 *
 * This tells us what the AI answer layer already considers authoritative,
 * so we can write articles that align with that knowledge — increasing the
 * probability that our article gets cited by these models.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { AiCitationInsight, CitationSources } from "../types";
import { log, elapsed } from "../../lib/logger";

const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY!;
const VERCEL_AI_GATEWAY_KEY = process.env.VERCEL_AI_GATEWAY_KEY!;
const VERCEL_GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";

const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

export async function runCitationAgent(primaryKeyword: string): Promise<CitationSources> {
  const t = Date.now();
  log.info("citation-agent", "start", { keyword: primaryKeyword });

  const prompt = buildAeoPrompt(primaryKeyword);

  // Query both models in parallel — treat each as an independent user query
  const [claudeResult, openaiResult] = await Promise.allSettled([
    queryClaudeDirectly(prompt, primaryKeyword),
    queryOpenAIViaGateway(prompt, primaryKeyword),
  ]);

  const insights: AiCitationInsight[] = [];

  if (claudeResult.status === "fulfilled") {
    insights.push(claudeResult.value);
  } else {
    log.error("citation-agent", "Claude query failed", {
      error: claudeResult.reason instanceof Error ? claudeResult.reason.message : String(claudeResult.reason),
    });
  }

  if (openaiResult.status === "fulfilled") {
    insights.push(openaiResult.value);
  } else {
    log.error("citation-agent", "OpenAI query failed", {
      error: openaiResult.reason instanceof Error ? openaiResult.reason.message : String(openaiResult.reason),
    });
  }

  const consensusTools = findConsensusTools(insights);

  const allSources = insights.flatMap((i) => i.sourcesReferenced.map((s) => s.name));
  const urls = allSources.filter(isUrl);
  const domains = Array.from(new Set(urls.map(extractDomain).filter(Boolean)));

  log.info("citation-agent", "complete", {
    ms: elapsed(t),
    modelsQueried: insights.length,
    consensusToolCount: consensusTools.length,
    consensusTools,
    totalSourceCount: allSources.length,
  });

  return { urls, domains, aiInsights: insights, consensusTools };
}

// ─── AEO prompt ──────────────────────────────────────────────────────────────

function buildAeoPrompt(keyword: string): string {
  return `I'm researching the best options for a B2B company in the US. What are the top 10 ${keyword} in the US?

For each tool, briefly explain:
- Why it's recommended
- What type of company it's best suited for

Also list any specific industry reports, ranking sites (like G2, Gartner Magic Quadrant, Capterra, Forrester), or authoritative sources that inform this category.

Finally, list 3–5 important facts or insights about the ${keyword} market (trends, market size, adoption patterns, key buying criteria, etc.).

Respond ONLY with a valid JSON object in this exact format:
{
  "tools": [
    { "name": "Tool Name", "rank": 1, "reasoning": "...", "best_for": "..." }
  ],
  "sources": [
    { "name": "G2 Crowd", "relevance": "User reviews and ratings for event software" }
  ],
  "key_insights": [
    "The global event management software market is projected to reach $X billion by 2027",
    "..."
  ]
}`;
}

// ─── Query Claude directly ───────────────────────────────────────────────────

async function queryClaudeDirectly(
  prompt: string,
  keyword: string
): Promise<AiCitationInsight> {
  const t = Date.now();
  log.info("citation-agent", "querying Claude (AEO)", { keyword });

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    messages: [{ role: "user", content: prompt }],
  });

  const rawResponse =
    response.content[0].type === "text" ? response.content[0].text : "";

  const insight = parseModelResponse(rawResponse, "claude-sonnet-4-6", keyword);

  log.info("citation-agent", "Claude AEO response parsed", {
    ms: elapsed(t),
    toolCount: insight.toolsMentioned.length,
    sourceCount: insight.sourcesReferenced.length,
    insightCount: insight.keyInsights.length,
    parseSuccess: insight.toolsMentioned.length > 0,
  });

  return insight;
}

// ─── Query OpenAI via Vercel AI Gateway ──────────────────────────────────────

async function queryOpenAIViaGateway(
  prompt: string,
  keyword: string
): Promise<AiCitationInsight> {
  const t = Date.now();

  if (!VERCEL_AI_GATEWAY_KEY) {
    throw new Error("VERCEL_AI_GATEWAY_KEY not set — skipping OpenAI AEO query");
  }

  log.info("citation-agent", "querying OpenAI via Vercel gateway (AEO)", {
    keyword,
    model: "openai/gpt-4o",
  });

  const res = await fetch(VERCEL_GATEWAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${VERCEL_AI_GATEWAY_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 2048,
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    log.error("citation-agent", "Vercel AI Gateway HTTP error", {
      status: res.status,
      statusText: res.statusText,
      body: errBody.slice(0, 500),
      ms: elapsed(t),
    });
    throw new Error(`Vercel AI Gateway error ${res.status}: ${errBody}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const rawResponse = data.choices?.[0]?.message?.content ?? "";
  const insight = parseModelResponse(rawResponse, "openai-gpt-4o", keyword);

  log.info("citation-agent", "OpenAI AEO response parsed", {
    ms: elapsed(t),
    toolCount: insight.toolsMentioned.length,
    sourceCount: insight.sourcesReferenced.length,
    insightCount: insight.keyInsights.length,
    parseSuccess: insight.toolsMentioned.length > 0,
  });

  return insight;
}

// ─── Parse a model's JSON response ───────────────────────────────────────────

function parseModelResponse(
  rawResponse: string,
  model: string,
  keyword: string
): AiCitationInsight {
  const fallback: AiCitationInsight = {
    model,
    toolsMentioned: [],
    sourcesReferenced: [],
    keyInsights: [],
    rawResponse,
  };

  try {
    const match = rawResponse.match(/\{[\s\S]*\}/);
    if (!match) {
      log.warn("citation-agent", "no JSON block in model response", { model, keyword });
      return { ...fallback };
    }

    const parsed = JSON.parse(match[0]) as {
      tools?: Array<{ name?: string; rank?: number; reasoning?: string; best_for?: string }>;
      sources?: Array<{ name?: string; relevance?: string }>;
      key_insights?: string[];
    };

    return {
      model,
      toolsMentioned: (parsed.tools ?? []).map((t, i) => ({
        name: t.name ?? "",
        rank: t.rank ?? i + 1,
        reasoning: t.reasoning ?? "",
        bestFor: t.best_for ?? "",
      })),
      sourcesReferenced: (parsed.sources ?? []).map((s) => ({
        name: s.name ?? "",
        relevance: s.relevance ?? "",
      })),
      keyInsights: parsed.key_insights ?? [],
      rawResponse,
    };
  } catch (err) {
    log.warn("citation-agent", "failed to parse model response as JSON", {
      model,
      keyword,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ...fallback };
  }
}

// ─── Find tools both models agree on ────────────────────────────────────────

function findConsensusTools(insights: AiCitationInsight[]): string[] {
  if (insights.length < 2) {
    return insights[0]?.toolsMentioned.slice(0, 5).map((t) => t.name) ?? [];
  }

  const toolSets = insights.map(
    (i) => new Set(i.toolsMentioned.map((t) => t.name.toLowerCase()))
  );

  const [first, ...rest] = toolSets;
  const intersection = Array.from(first).filter((tool) =>
    rest.every((set) => set.has(tool))
  );

  return intersection
    .map((lowerName) =>
      insights[0].toolsMentioned.find((t) => t.name.toLowerCase() === lowerName)?.name ?? lowerName
    )
    .slice(0, 10);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isUrl(str: string): boolean {
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
