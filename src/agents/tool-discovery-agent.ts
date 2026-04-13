/**
 * Tool Discovery Agent
 *
 * Runs 3 Serper searches in parallel for the keyword category, then sends all
 * results to Claude to extract, deduplicate, and rank actual tool candidates.
 *
 * Fast (~3s total). No polling. No hardcoded tool lists.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ToolCandidate } from "../types";
import { log, elapsed } from "../../lib/logger";
import { searchSerperForTools } from "../services/serp";

const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY!;

const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

export async function runToolDiscoveryAgent(
  primaryKeyword: string,
  targetCount: number
): Promise<ToolCandidate[]> {
  const t = Date.now();
  log.info("tool-discovery", "start", { keyword: primaryKeyword, targetCount });

  const searchText = await fetchSerperResults(primaryKeyword);
  const candidates = await rankWithClaude(searchText, primaryKeyword, targetCount);

  log.info("tool-discovery", "complete", {
    ms: elapsed(t),
    candidateCount: candidates.length,
    hadSearchData: searchText.trim().length > 0,
  });

  return candidates;
}

// ─── Serper searches ──────────────────────────────────────────────────────────

async function fetchSerperResults(keyword: string): Promise<string> {
  const queries = [
    `best ${keyword} software 2025`,
    `top ${keyword} platforms comparison reviews`,
    `${keyword} tools site:g2.com OR site:capterra.com OR site:getapp.com`,
  ];

  log.info("tool-discovery", "running Serper searches", {
    queryCount: queries.length,
    queries,
  });

  const results = await Promise.allSettled(queries.map((q) => searchSerperForTools(q)));

  const sections: string[] = [];
  let successCount = 0;

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled" && r.value) {
      sections.push(`=== Search: "${queries[i]}" ===\n${r.value}`);
      successCount++;
    } else if (r.status === "rejected") {
      log.warn("tool-discovery", "Serper query failed", {
        query: queries[i],
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      });
    }
  }

  log.info("tool-discovery", "Serper searches complete", {
    successCount,
    totalQueries: queries.length,
    totalChars: sections.join("").length,
  });

  return sections.join("\n\n");
}

// ─── Claude extraction + ranking ──────────────────────────────────────────────

async function rankWithClaude(
  rawData: string,
  keyword: string,
  targetCount: number
): Promise<ToolCandidate[]> {
  const t = Date.now();
  const hasData = rawData.trim().length > 0;

  log.info("tool-discovery", "sending to Claude for extraction", {
    keyword,
    targetCount,
    inputChars: rawData.length,
    source: hasData ? "serper" : "claude-knowledge",
  });

  const prompt = `You are identifying software tools for an SEO article about "${keyword}" targeting US B2B companies.

${hasData
  ? `Here are Google search results for this category:\n\n${rawData}\n\nExtract ALL software tools and platforms mentioned in these results.`
  : `No search data was available. Use your knowledge of the "${keyword}" market to identify the most relevant tools.`
}

For each tool:
1. Use its official website URL (from search results, or your knowledge if not shown)
2. Assign confidence based on how prominently it appeared (search results = higher confidence)
3. Write a one-sentence reason it's relevant for "${keyword}"

Rules:
- Include Zuddl (zuddl.com) — it is the company writing this article, set confidence 0.95
- Do NOT include comparison/review sites (G2, Capterra, GetApp), consulting firms, or generic SaaS platforms
- Aim for ${targetCount + 3} tools total so the human reviewer has options to remove
- Only include tools that directly serve the "${keyword}" use case

Return ONLY a valid JSON array, no commentary:
[
  {
    "name": "Tool Name",
    "website": "https://toolwebsite.com",
    "confidence": 0.9,
    "source": "${hasData ? "serper" : "claude-knowledge"}",
    "reason": "One sentence explaining why this tool belongs in this list"
  }
]`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";
    const match = text.match(/\[[\s\S]*\]/);

    if (!match) {
      log.warn("tool-discovery", "Claude returned no JSON array", { keyword });
      return [];
    }

    const parsed = JSON.parse(match[0]) as ToolCandidate[];

    // Ensure Zuddl is always present
    const hasZuddl = parsed.some(
      (t) => t.name.toLowerCase() === "zuddl" || t.website?.includes("zuddl.com")
    );

    if (!hasZuddl) {
      parsed.unshift({
        name: "Zuddl",
        website: "https://zuddl.com",
        confidence: 0.95,
        source: "required",
        reason: `Enterprise ${keyword} platform — the company writing this article`,
      });
    }

    const final = parsed.slice(0, targetCount + 3);

    log.info("tool-discovery", "Claude extraction complete", {
      ms: elapsed(t),
      parsedCount: parsed.length,
      finalCount: final.length,
      zuddlAdded: !hasZuddl,
      topTools: final.slice(0, 5).map((t) => t.name),
    });

    return final;
  } catch (err) {
    log.error("tool-discovery", "Claude extraction failed", {
      error: err instanceof Error ? err.message : String(err),
      ms: elapsed(t),
    });
    return [];
  }
}
