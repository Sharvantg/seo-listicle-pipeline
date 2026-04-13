/**
 * SERP Service — Serper API
 * Fetches top 5 ranking articles and extracts domains they link to.
 */

import type { SerpInsights, SerpResult } from "../types";
import { log, elapsed } from "../../lib/logger";

const SERPER_API_KEY = process.env.SERPER_API_KEY!;

interface SerperOrganicResult {
  title: string;
  link: string;
  snippet: string;
  position?: number;
}

interface SerperResponse {
  organic?: SerperOrganicResult[];
}

export async function runSerpService(query: string): Promise<SerpInsights> {
  const t = Date.now();
  log.info("serp-service", "start", { query });

  const results = await searchSerper(query);

  const topResults: SerpResult[] = results.slice(0, 5).map((r, i) => ({
    title: r.title,
    url: r.link,
    domain: extractDomain(r.link),
    snippet: r.snippet,
    position: r.position ?? i + 1,
  }));

  const linkedDomains = deriveLinkedDomains(topResults);
  const commonTopics = extractCommonTopics(topResults);

  log.info("serp-service", "complete", {
    ms: elapsed(t),
    resultCount: results.length,
    topResultCount: topResults.length,
    linkedDomainCount: linkedDomains.length,
    commonTopicCount: commonTopics.length,
  });

  return {
    topResults,
    linkedDomains,
    commonTopics,
  };
}

// Keep the old export name as an alias for backward compatibility during transition
export { runSerpService as runSerpAgent };

/**
 * Raw Serper search — returns formatted text block for Claude consumption.
 * Used by tool-discovery-agent.
 */
export async function searchSerperForTools(query: string): Promise<string> {
  const t = Date.now();
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": SERPER_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, num: 10, gl: "us", hl: "en" }),
    });

    if (!res.ok) {
      log.warn("serp-service", "Serper HTTP error", {
        status: res.status,
        statusText: res.statusText,
        query,
        ms: elapsed(t),
      });
      return "";
    }

    const data = (await res.json()) as {
      organic?: Array<{ title?: string; link?: string; snippet?: string }>;
      peopleAlsoAsk?: Array<{ question?: string }>;
      relatedSearches?: Array<{ query?: string }>;
    };

    const lines: string[] = [];

    for (const r of data.organic ?? []) {
      if (r.title) lines.push(`TITLE: ${r.title}`);
      if (r.link) lines.push(`URL: ${r.link}`);
      if (r.snippet) lines.push(`SNIPPET: ${r.snippet}`);
      lines.push("---");
    }

    for (const paa of data.peopleAlsoAsk ?? []) {
      if (paa.question) lines.push(`PEOPLE ALSO ASK: ${paa.question}`);
    }

    for (const rel of data.relatedSearches ?? []) {
      if (rel.query) lines.push(`RELATED SEARCH: ${rel.query}`);
    }

    log.info("serp-service", "Serper query OK", {
      ms: elapsed(t),
      organicCount: data.organic?.length ?? 0,
      query,
    });

    return lines.join("\n");
  } catch (err) {
    log.error("serp-service", "Serper fetch exception", {
      error: err instanceof Error ? err.message : String(err),
      query,
      ms: elapsed(t),
    });
    return "";
  }
}

async function searchSerper(query: string): Promise<SerperOrganicResult[]> {
  const t = Date.now();
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": SERPER_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, num: 10 }),
    });

    if (!res.ok) {
      log.warn("serp-service", "Serper HTTP error", {
        status: res.status,
        statusText: res.statusText,
        query,
        ms: elapsed(t),
      });
      return [];
    }

    const data = await res.json() as SerperResponse;
    const count = data.organic?.length ?? 0;
    log.info("serp-service", "Serper OK", { ms: elapsed(t), resultCount: count, query });
    return data.organic ?? [];
  } catch (err) {
    log.error("serp-service", "Serper exception", {
      error: err instanceof Error ? err.message : String(err),
      query,
      ms: elapsed(t),
    });
    return [];
  }
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function deriveLinkedDomains(results: SerpResult[]): string[] {
  // Return actual domains from SERP results — these are the sites ranking for this keyword.
  // Authority domains (G2, Gartner, etc.) come from the citation agent's sourcesReferenced.
  return Array.from(
    new Set(results.map((r) => r.domain).filter((d) => !d.includes("zuddl.com")))
  );
}

function extractCommonTopics(results: SerpResult[]): string[] {
  // Extract words that appear in at least 2 results — dynamic, not keyword-specific.
  const stopWords = new Set([
    "the", "a", "an", "and", "or", "for", "to", "of", "in", "on", "at", "with",
    "is", "are", "that", "this", "it", "be", "as", "by", "from", "was", "has",
    "have", "its", "their", "they", "you", "your", "our", "we", "can", "will",
    "how", "what", "when", "where", "which", "who", "best", "top", "most",
  ]);

  const wordCounts = new Map<string, number>();

  for (const result of results) {
    const text = `${result.title} ${result.snippet}`.toLowerCase();
    const words = text.match(/\b[a-z]{4,}\b/g) ?? [];
    const unique = new Set<string>(words); // count once per result
    for (const word of Array.from(unique)) {
      if (!stopWords.has(word)) {
        wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1);
      }
    }
  }

  return Array.from(wordCounts.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);
}
