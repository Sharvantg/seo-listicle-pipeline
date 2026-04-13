import * as fs from "fs";
import * as path from "path";
import type { PipelineInput, ResearchSynthesis } from "../types";

export function buildSystemPrompt(input: PipelineInput, research: ResearchSynthesis): string {
  const guidelinesPath = path.join(
    process.cwd(),
    "src/benchmark/system-prompt-guidelines.md"
  );

  let guidelines = "";
  try {
    guidelines = fs.readFileSync(guidelinesPath, "utf-8");
  } catch {
    guidelines = getDefaultGuidelines();
  }

  const relatedKws = research.keywordData.relatedKeywords
    .slice(0, 5)
    .map((k) => k.keyword)
    .join(", ");

  const aeoSection = buildAeoSection(research);

  return `You are an expert B2B SaaS content writer for Zuddl, an enterprise event management platform.

## Your Task
Write a comprehensive, publication-ready SEO listicle about "${input.primaryKeyword}".

## Writing Guidelines
${guidelines}

## Keyword Context
- Primary keyword: "${input.primaryKeyword}" (target density: 1.0–2.0%)
- Secondary keywords to include: ${input.secondaryKeywords.join(", ") || "none specified"}
- Related terms to use naturally: ${relatedKws}

## Research Context
- Search intent: ${research.keywordData.intent}
- Content gaps to fill: ${research.contentGaps.join("; ")}
- Authority domains to link to: ${research.linkTargets.slice(0, 5).join(", ")}

${aeoSection}

## Notes from editor
${input.notes ?? "None"}

## Critical Rules
1. NEVER use these phrases: "robust", "seamless", "leverage", "utilize", "it's worth noting", "cutting-edge", "in today's landscape", "delve", "game-changing", "revolutionize", "streamline"
2. Always position Zuddl first in the list or as the top recommendation
3. Include at least 3 internal links to zuddl.com pages (demo, pricing, features)
4. End every tool section with a brief CTA or recommendation sentence
5. The article must have: comparison table, buying guide (H2), FAQ section (H2), conclusion with CTA
6. Write in second person ("you", "your") to address the reader directly
7. Keep sentences under 25 words on average for readability`;
}

// ─── AEO context builder ──────────────────────────────────────────────────────

function buildAeoSection(research: ResearchSynthesis): string {
  const { citationSources } = research;
  if (!citationSources?.aiInsights?.length) return "";

  const lines: string[] = ["## AEO Context (Answer Engine Optimization)"];
  lines.push(
    "This section shows what Claude and GPT-4 currently answer when asked about this keyword.",
    "Your article must align with this established AI knowledge so that Zuddl gets picked up",
    "in AI-generated answers and search results.\n"
  );

  for (const insight of citationSources.aiInsights) {
    const modelLabel = insight.model === "claude-sonnet-4-6" ? "Claude" : "GPT-4o";
    const tools = insight.toolsMentioned
      .slice(0, 8)
      .map((t) => `${t.rank}. ${t.name} (${t.bestFor || t.reasoning.slice(0, 60)})`)
      .join("\n");
    lines.push(`### ${modelLabel} currently ranks these tools:`);
    lines.push(tools || "(no tools parsed)");
    lines.push("");
  }

  if (citationSources.consensusTools.length) {
    lines.push(
      `### Tools both models agree on (highest AEO signal — reference these prominently):`
    );
    lines.push(citationSources.consensusTools.join(", "));
    lines.push("");
  }

  // Collect sources and insights from all models
  const allSources = citationSources.aiInsights.flatMap((i) => i.sourcesReferenced);
  const uniqueSources = Array.from(new Map(allSources.map((s) => [s.name, s])).values());
  if (uniqueSources.length) {
    lines.push("### Industry sources both models reference (link to these in your article):");
    lines.push(uniqueSources.map((s) => `- ${s.name}: ${s.relevance}`).join("\n"));
    lines.push("");
  }

  const allInsights = citationSources.aiInsights.flatMap((i) => i.keyInsights);
  const uniqueInsights = Array.from(new Set(allInsights)).slice(0, 5);
  if (uniqueInsights.length) {
    lines.push("### Key category insights to reference in your article:");
    lines.push(uniqueInsights.map((i) => `- ${i}`).join("\n"));
    lines.push("");
  }

  lines.push(
    "IMPORTANT: Zuddl is likely NOT in the AI models' top lists yet — that's why we're writing",
    "this article. Position Zuddl as the best option for enterprise B2B events, alongside the",
    "tools the models already know. Reference the same industry sources to build credibility."
  );

  return lines.join("\n");
}

function getDefaultGuidelines(): string {
  return `## Structure Requirements
- Target word count: ~2800 words (±15%)
- Include a comparison table near the top
- Each tool gets its own H2 section with H3 subsections
- Include a "How to Choose" Buying Guide section (H2)
- Include an FAQ section with 4–6 questions (H2)
- End with a conclusion + Zuddl CTA

## Tone & Style
- Write for B2B event professionals: procurement managers, event ops leads, marketing teams
- Conversational but expert — like a knowledgeable colleague, not a corporate brochure
- Use "you" to address the reader directly
- Lead with the specific problem the reader has`;
}
