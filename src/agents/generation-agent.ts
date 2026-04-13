/**
 * Generation Agent — Claude
 * Generates the full SEO listicle article from research + tool data.
 * Two passes: generation (full article in one call) → humanization.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { GeneratedDraft, PipelineInput, ResearchSynthesis, ToolData } from "../types";
import { buildSystemPrompt } from "../prompts/system-prompt";
import { buildFullArticlePrompt, buildHumanizationPrompt } from "../prompts/section-prompts";
import { generateSchemas } from "../integrations/semantic-markup";
import { log, elapsed } from "../../lib/logger";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY! });

export async function runGenerationAgent(
  input: PipelineInput,
  research: ResearchSynthesis,
  tools: ToolData[]
): Promise<GeneratedDraft> {
  const t = Date.now();
  log.info("generation", "start", {
    keyword: input.primaryKeyword,
    toolCount: tools.length,
    toolNames: tools.map((t) => t.name),
  });

  const systemPrompt = buildSystemPrompt(input, research);

  // Call 1: Generate full article in one shot
  log.info("generation", "generating full article");
  const tGen = Date.now();
  const genResponse = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8000,
    system: systemPrompt,
    messages: [{ role: "user", content: buildFullArticlePrompt(input, tools) }],
  });
  const rawContent = genResponse.content[0].type === "text" ? genResponse.content[0].text : "";
  log.info("generation", "article generated", { ms: elapsed(tGen), words: countWords(rawContent) });

  // Call 2: Humanization pass
  log.info("generation", "running humanization pass");
  const tHuman = Date.now();
  let finalContent = rawContent;
  try {
    const humanResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8000,
      system: systemPrompt,
      messages: [{ role: "user", content: buildHumanizationPrompt(rawContent) }],
    });
    finalContent = humanResponse.content[0].type === "text" ? humanResponse.content[0].text : rawContent;
  } catch (err) {
    log.warn("generation", "humanization failed — using raw draft", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const finalWordCount = countWords(finalContent);
  log.info("generation", "humanization complete", { ms: elapsed(tHuman), words: finalWordCount });

  const kwDensity = calculateKwDensity(finalContent, input.primaryKeyword);
  const title = buildTitle(input.primaryKeyword, tools.length);
  const slug = buildSlug(title);
  const metaDescription = buildMetaDescription(input.primaryKeyword, tools.length);

  const jsonLd = generateSchemas({
    title,
    slug,
    tools,
    content: finalContent,
    primaryKeyword: input.primaryKeyword,
  });

  log.info("generation", "complete", {
    ms: elapsed(t),
    title,
    slug,
    wordCount: finalWordCount,
    kwDensityPct: (kwDensity * 100).toFixed(2),
  });

  return {
    title,
    metaDescription,
    slug,
    content: finalContent,
    wordCount: finalWordCount,
    primaryKwDensity: kwDensity,
    jsonLd,
  };
}

function buildTitle(keyword: string, toolCount: number): string {
  const year = new Date().getFullYear();
  return `${toolCount} Best ${toTitleCase(keyword)} in ${year} (Compared & Reviewed)`;
}

function buildSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

function buildMetaDescription(keyword: string, toolCount: number): string {
  return `Looking for the best ${keyword}? We've compared ${toolCount} top options on pricing, features, and use cases to help you choose the right platform.`;
}

function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

function calculateKwDensity(content: string, keyword: string): number {
  const wordCount = countWords(content);
  if (wordCount === 0) return 0;
  const matches = content.match(new RegExp(escapeRegex(keyword), "gi")) ?? [];
  return (matches.length * keyword.split(/\s+/).length) / wordCount;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toTitleCase(str: string): string {
  return str
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}
