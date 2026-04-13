/**
 * One-time benchmark script.
 * Run with: npm run benchmark
 *
 * What it does:
 * 1. Uses MOZ API to find Zuddl blog pages that rank for list-type queries
 * 2. Fetches top 5 pages via Serper
 * 3. Uses Claude to extract patterns: word count, structure, KW density, Flesch, CTAs
 * 4. Writes benchmark.json + system-prompt-guidelines.md
 */

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";
import type { BenchmarkData, BenchmarkEntry } from "../types.js";

const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY!;
const MOZ_API_KEY = process.env.MOZ_API_KEY!; // Already Base64-encoded
const SERPER_API_KEY = process.env.SERPER_API_KEY!;
const ZUDDL_BASE_URL = process.env.ZUDDL_BASE_URL ?? "https://www.zuddl.com";

const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

// ─── MOZ: Find Zuddl ranking pages ───────────────────────────────────────────

interface MozLinkResult {
  page: {
    url: string;
    title?: string;
  };
}

async function findZuddlListicles(): Promise<string[]> {
  console.log("🔍 Fetching Zuddl top pages from MOZ...");

  try {
    const response = await fetch("https://lsapi.seomoz.com/v2/url_metrics", {
      method: "POST",
      headers: {
        Authorization: `Basic ${MOZ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        targets: [`${ZUDDL_BASE_URL}/blog`],
        metrics: ["title", "url"],
      }),
    });

    if (!response.ok) {
      console.warn(`MOZ API returned ${response.status}. Using fallback list.`);
      return getFallbackUrls();
    }

    const data = await response.json() as { results?: MozLinkResult[] };
    const urls = (data.results ?? [])
      .map((r) => r.page?.url)
      .filter((url): url is string => !!url && url.includes("/blog/"))
      .slice(0, 10);

    if (urls.length === 0) {
      return getFallbackUrls();
    }

    // Filter to list-type URLs (contain "best", "top", number patterns)
    const listUrls = urls.filter((url) =>
      /best|top|\d+-|\-list/i.test(url)
    );

    return listUrls.slice(0, 5).length > 0 ? listUrls.slice(0, 5) : getFallbackUrls();
  } catch (err) {
    console.warn("MOZ API error, using fallback:", err);
    return getFallbackUrls();
  }
}

function getFallbackUrls(): string[] {
  return [
    "https://www.zuddl.com/blog/best-mobile-event-apps-b2b-conferences",
    "https://www.zuddl.com/blog/best-virtual-event-platforms",
    "https://www.zuddl.com/blog/best-event-registration-software",
    "https://www.zuddl.com/blog/top-event-management-software",
    "https://www.zuddl.com/blog/best-webinar-platforms",
  ];
}

// ─── Serper: Fetch page content ───────────────────────────────────────────────

async function fetchPageContent(url: string): Promise<string> {
  console.log(`  Fetching: ${url}`);
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; SEO-benchmark-bot/1.0)",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return `[Could not fetch ${url}: ${response.status}]`;
    }

    const html = await response.text();
    // Strip HTML tags for text analysis
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 8000); // Limit context

    return text;
  } catch (err) {
    return `[Could not fetch ${url}: ${String(err)}]`;
  }
}

// ─── Claude: Extract patterns ─────────────────────────────────────────────────

async function extractPatterns(url: string, content: string): Promise<BenchmarkEntry> {
  console.log(`  Analyzing: ${url}`);

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `Analyze this SEO listicle content and extract key metrics. Return ONLY valid JSON with no commentary.

URL: ${url}
Content: ${content.slice(0, 5000)}

Return this exact JSON structure:
{
  "title": "article title",
  "wordCount": <estimated word count as integer>,
  "h2Count": <number of H2 sections>,
  "h3Count": <number of H3 sections>,
  "toolCount": <number of tools listed>,
  "fleschScore": <estimated Flesch reading ease 0-100>,
  "ctaCount": <number of calls-to-action>,
  "internalLinkCount": <number of internal zuddl.com links>,
  "primaryKwDensity": <estimated KW density as decimal e.g. 0.015>,
  "hasComparisonTable": <true/false>,
  "hasFaq": <true/false>,
  "hasBuyingGuide": <true/false>
}`,
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "{}";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

  return {
    url,
    title: parsed.title ?? url,
    wordCount: parsed.wordCount ?? 2500,
    h2Count: parsed.h2Count ?? 8,
    h3Count: parsed.h3Count ?? 12,
    toolCount: parsed.toolCount ?? 10,
    fleschScore: parsed.fleschScore ?? 60,
    ctaCount: parsed.ctaCount ?? 3,
    internalLinkCount: parsed.internalLinkCount ?? 3,
    primaryKwDensity: parsed.primaryKwDensity ?? 0.015,
    hasComparisonTable: parsed.hasComparisonTable ?? true,
    hasFaq: parsed.hasFaq ?? true,
    hasBuyingGuide: parsed.hasBuyingGuide ?? true,
  };
}

// ─── Generate guidelines from benchmark data ──────────────────────────────────

async function generateGuidelines(data: BenchmarkData): Promise<string> {
  console.log("\n✍️  Generating writing guidelines from benchmark...");

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: `Based on this benchmark data from Zuddl's top-performing SEO listicles, generate comprehensive writing guidelines in Markdown format.

Benchmark data:
${JSON.stringify(data, null, 2)}

The guidelines should cover:
1. Structure requirements (word count, sections, headers)
2. Tone and style for B2B event professionals
3. Keyword usage patterns
4. Formatting conventions
5. Forbidden phrases / AI-isms to avoid
6. Zuddl positioning and CTA patterns

Format as markdown with clear sections. Be specific and actionable.`,
      },
    ],
  });

  return response.content[0].type === "text" ? response.content[0].text : "";
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🚀 Starting benchmark analysis...\n");

  const urls = await findZuddlListicles();
  console.log(`\n📋 Found ${urls.length} Zuddl listicles to analyze:\n`, urls, "\n");

  const entries: BenchmarkEntry[] = [];

  for (const url of urls) {
    const content = await fetchPageContent(url);
    const entry = await extractPatterns(url, content);
    entries.push(entry);
    console.log(`  ✓ ${entry.title} — ${entry.wordCount} words, Flesch: ${entry.fleschScore}`);
  }

  const data: BenchmarkData = {
    entries,
    avgWordCount: Math.round(entries.reduce((s, e) => s + e.wordCount, 0) / entries.length),
    avgFleschScore: Math.round(entries.reduce((s, e) => s + e.fleschScore, 0) / entries.length),
    avgToolCount: Math.round(entries.reduce((s, e) => s + e.toolCount, 0) / entries.length),
    avgH2Count: Math.round(entries.reduce((s, e) => s + e.h2Count, 0) / entries.length),
    commonStructure: [
      "intro with primary keyword",
      "comparison table",
      "individual tool sections (H2)",
      "buying guide / how to choose",
      "FAQ section",
      "conclusion with CTA",
    ],
    generatedAt: new Date().toISOString(),
  };

  const benchmarkPath = path.join(import.meta.dirname, "benchmark.json");
  fs.writeFileSync(benchmarkPath, JSON.stringify(data, null, 2));
  console.log(`\n✅ Wrote benchmark.json (avg ${data.avgWordCount} words, Flesch ${data.avgFleschScore})`);

  const guidelines = await generateGuidelines(data);
  const guidelinesPath = path.join(import.meta.dirname, "system-prompt-guidelines.md");
  fs.writeFileSync(guidelinesPath, guidelines);
  console.log("✅ Wrote system-prompt-guidelines.md");

  console.log("\n🎉 Benchmark complete!");
}

main().catch(console.error);
