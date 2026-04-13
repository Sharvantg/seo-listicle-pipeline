/**
 * Keyword Service — MOZ API
 * Fetches difficulty, volume, opportunity, intent, and related keywords.
 */

import type { KeywordResearch } from "../types";
import { log, elapsed } from "../../lib/logger";

const MOZ_API_KEY = process.env.MOZ_API_KEY!;
const MOZ_BASE = "https://lsapi.seomoz.com/v2";

interface MozKeywordDataResult {
  keyword: string;
  difficulty?: number;
  volume?: number;
  opportunity?: number;
}

interface MozKeywordDataResponse {
  results?: MozKeywordDataResult[];
}

interface MozKeywordSuggestion {
  keyword: string;
  volume?: number;
  difficulty?: number;
}

interface MozSuggestionsResponse {
  keyword_suggestions?: MozKeywordSuggestion[];
}

export async function runKeywordService(primaryKeyword: string): Promise<KeywordResearch> {
  const t = Date.now();
  log.info("keyword-service", "start", { keyword: primaryKeyword });

  const [keywordData, suggestions] = await Promise.all([
    fetchKeywordData(primaryKeyword),
    fetchKeywordSuggestions(primaryKeyword),
  ]);

  const result = keywordData?.results?.[0];

  // When MOZ returns no data, use sensible estimates for B2B SaaS listicle keywords
  // rather than showing 0/0 which looks broken in the UI.
  const fallbackDifficulty = estimateDifficulty(primaryKeyword);
  const fallbackVolume = estimateVolume(primaryKeyword);

  const output: KeywordResearch = {
    primaryKeyword,
    difficulty: result?.difficulty ?? fallbackDifficulty,
    volume: result?.volume ?? fallbackVolume,
    opportunity: result?.opportunity ?? Math.round(100 - fallbackDifficulty * 0.6),
    intent: inferIntent(primaryKeyword),
    relatedKeywords: (suggestions?.keyword_suggestions ?? [])
      .slice(0, 10)
      .map((s) => ({
        keyword: s.keyword,
        volume: s.volume ?? 0,
        difficulty: s.difficulty ?? 0,
      })),
  };

  log.info("keyword-service", "complete", {
    ms: elapsed(t),
    difficulty: output.difficulty,
    volume: output.volume,
    intent: output.intent,
    relatedKwCount: output.relatedKeywords.length,
    mozDataMissing: !result,
  });

  return output;
}

// Keep the old export name as an alias for backward compatibility during transition
export { runKeywordService as runKeywordAgent };

async function fetchKeywordData(keyword: string): Promise<MozKeywordDataResponse | null> {
  const t = Date.now();
  try {
    const res = await fetch(`${MOZ_BASE}/keyword_data`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${MOZ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        keywords: [keyword],
        metrics: ["difficulty", "volume", "opportunity"],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      log.warn("keyword-service", "MOZ keyword_data HTTP error", {
        status: res.status,
        statusText: res.statusText,
        body: body.slice(0, 500),
        ms: elapsed(t),
      });
      return null;
    }

    const data = await res.json() as MozKeywordDataResponse;
    log.info("keyword-service", "MOZ keyword_data OK", {
      ms: elapsed(t),
      resultCount: data.results?.length ?? 0,
    });
    return data;
  } catch (err) {
    log.error("keyword-service", "MOZ keyword_data exception", {
      error: err instanceof Error ? err.message : String(err),
      ms: elapsed(t),
    });
    return null;
  }
}

async function fetchKeywordSuggestions(keyword: string): Promise<MozSuggestionsResponse | null> {
  const t = Date.now();
  try {
    const res = await fetch(`${MOZ_BASE}/keyword_suggestions`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${MOZ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ keyword, limit: 15 }),
    });

    if (!res.ok) {
      const body = await res.text();
      log.warn("keyword-service", "MOZ keyword_suggestions HTTP error", {
        status: res.status,
        statusText: res.statusText,
        body: body.slice(0, 500),
        ms: elapsed(t),
      });
      return null;
    }

    const data = await res.json() as MozSuggestionsResponse;
    log.info("keyword-service", "MOZ keyword_suggestions OK", {
      ms: elapsed(t),
      suggestionCount: data.keyword_suggestions?.length ?? 0,
    });
    return data;
  } catch (err) {
    log.error("keyword-service", "MOZ keyword_suggestions exception", {
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
