/**
 * Keyword Service — MOZ API
 * Fetches difficulty, volume, opportunity, intent, and related keywords.
 */

import { randomUUID } from "crypto";
import type { KeywordResearch } from "../types";
import { log, elapsed } from "../../lib/logger";

const MOZ_API_KEY = process.env.MOZ_API_KEY!;
const MOZ_JSONRPC = "https://api.moz.com/jsonrpc";

interface MozMetricsResult {
  keyword_metrics?: {
    difficulty?: number | null;
    volume?: number | null;
    organic_ctr?: number | null;
    priority?: number | null;
  };
}

export async function runKeywordService(primaryKeyword: string): Promise<KeywordResearch> {
  const t = Date.now();
  log.info("keyword-service", "start", { keyword: primaryKeyword });

  const metrics = await fetchKeywordMetrics(primaryKeyword);

  const fallbackDifficulty = estimateDifficulty(primaryKeyword);
  const fallbackVolume = estimateVolume(primaryKeyword);

  const m = metrics?.keyword_metrics;
  const output: KeywordResearch = {
    primaryKeyword,
    difficulty: m?.difficulty ?? fallbackDifficulty,
    volume: m?.volume ?? fallbackVolume,
    opportunity: m?.organic_ctr ?? Math.round(100 - fallbackDifficulty * 0.6),
    intent: inferIntent(primaryKeyword),
    relatedKeywords: [], // suggestions endpoint requires paid tier
  };

  log.info("keyword-service", "complete", {
    ms: elapsed(t),
    difficulty: output.difficulty,
    volume: output.volume,
    organic_ctr: m?.organic_ctr,
    intent: output.intent,
    mozDataMissing: !m,
  });

  return output;
}

export { runKeywordService as runKeywordAgent };

async function fetchKeywordMetrics(keyword: string): Promise<MozMetricsResult | null> {
  const t = Date.now();
  try {
    const res = await fetch(MOZ_JSONRPC, {
      method: "POST",
      headers: {
        "x-moz-token": MOZ_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: randomUUID(),
        method: "data.keyword.metrics.fetch",
        params: {
          data: {
            serp_query: {
              keyword,
              locale: "en-US",
              device: "desktop",
              engine: "google",
            },
          },
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      log.warn("keyword-service", "MOZ metrics HTTP error", {
        status: res.status,
        body: body.slice(0, 500),
        ms: elapsed(t),
      });
      return null;
    }

    const data = await res.json() as { result?: MozMetricsResult; error?: { message: string } };

    if (data.error) {
      log.warn("keyword-service", "MOZ metrics JSON-RPC error", {
        error: data.error.message,
        ms: elapsed(t),
      });
      return null;
    }

    log.info("keyword-service", "MOZ metrics OK", {
      ms: elapsed(t),
      difficulty: data.result?.keyword_metrics?.difficulty,
      volume: data.result?.keyword_metrics?.volume,
    });
    return data.result ?? null;
  } catch (err) {
    log.error("keyword-service", "MOZ metrics exception", {
      error: err instanceof Error ? err.message : String(err),
      ms: elapsed(t),
    });
    return null;
  }
}

/**
 * Estimate keyword difficulty when MOZ API is unavailable.
 * B2B SaaS comparison keywords are typically medium difficulty (40–60).
 */
function estimateDifficulty(keyword: string): number {
  const kw = keyword.toLowerCase();
  // High competition: very generic or short terms
  if (kw.split(" ").length <= 2) return 58;
  // Medium: specific comparison / listicle terms
  if (/best|top|vs|compar/i.test(kw)) return 45;
  // Lower: long-tail specific use-case terms
  return 38;
}

/**
 * Estimate monthly search volume when MOZ API is unavailable.
 * B2B SaaS niches are lower volume than consumer terms.
 */
function estimateVolume(keyword: string): number {
  const kw = keyword.toLowerCase();
  if (/best|top/i.test(kw)) return 2400;  // listicle intent, highest commercial volume
  if (/vs|compar/i.test(kw)) return 1200; // comparison intent
  return 800;                              // other B2B niche terms
}

function inferIntent(
  keyword: string
): "informational" | "commercial" | "navigational" | "transactional" {
  const kw = keyword.toLowerCase();
  if (/\bbest\b|\btop\b|\bvs\b|\bcompar/i.test(kw)) return "commercial";
  if (/\bbuy\b|\bpric/i.test(kw)) return "transactional";
  if (/\bhow\b|\bwhat\b|\bwhy\b|\bguide\b/i.test(kw)) return "informational";
  return "commercial"; // listicle queries are typically commercial intent
}
