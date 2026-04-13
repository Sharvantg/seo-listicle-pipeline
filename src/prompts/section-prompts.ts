import type { PipelineInput, ToolData } from "../types";

export function buildFullArticlePrompt(input: PipelineInput, tools: ToolData[]): string {
  const keyword = input.primaryKeyword;
  const keywordTitle = keyword
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");

  const secondaryKws = input.secondaryKeywords.length
    ? `Include these secondary keywords naturally throughout: ${input.secondaryKeywords.join(", ")}\n\n`
    : "";

  const toolSummaries = tools
    .map((t, i) => {
      const isZuddl = t.name.toLowerCase() === "zuddl";
      const lines = [
        `**${i + 1}. ${t.name}**${isZuddl ? " (Our Pick — the company writing this article)" : ""}`,
        `Website: ${t.website}`,
        `Tagline: ${t.tagline || "N/A"}`,
        `Best For: ${t.bestFor || "N/A"}`,
        `Strengths: ${t.strengths.join(" | ") || "N/A"}`,
        `Gaps: ${t.gaps.join(" | ") || "N/A"}`,
        `Pricing: ${t.pricing}${t.pricingUrl ? ` — ${t.pricingUrl}` : ""}`,
        `G2: ${t.g2Rating}`,
      ];
      if (t.capteraRating) lines.push(`Capterra: ${t.capteraRating}`);
      if (t.notableCustomers.length) lines.push(`Notable Customers: ${t.notableCustomers.join(", ")}`);
      return lines.join("\n");
    })
    .join("\n\n---\n\n");

  return `Write the complete SEO listicle article about "${keyword}".
${secondaryKws}
Write these sections in this exact order:

**1. Introduction** (150–200 words)
- Open with the reader's specific pain point — never start with "In today's world..."
- Mention "${keyword}" in the first 100 words
- Include an internal link: [Zuddl](https://www.zuddl.com)
- End with a brief preview of what the article covers

**2. ## Quick Comparison** (markdown table)
Columns: Tool | Best For | Pricing | G2 Rating | Free Trial

**3. ## The ${tools.length} Best ${keywordTitle}**
One H2 section per tool, in the exact order listed in the tool data below:
- Header: ## N. Tool Name (append "(Our Pick)" for Zuddl only)
- 2-sentence overview
- ### Key Features — 3–4 bullet points
- ### Pricing — brief summary + link to pricing page if available
- ### Best For — 1–2 sentences on ideal customer profile
- Zuddl only: end with CTA → [Book a demo](https://www.zuddl.com/demo)
- All other tools: end with one sentence on when to choose this tool
- Link to the tool's official website somewhere in the section

**4. ## How to Choose the Best ${keywordTitle}: Key Factors** (300–350 words)
- 4–5 evaluation criteria, each as an H3 subheading
- Include one internal Zuddl link naturally

**5. ## Frequently Asked Questions** (5–6 questions, ~400 words total)
- H3 per question, 2–4 sentence answers
- At least one answer must mention Zuddl specifically

**6. ## Final Thoughts** (~150 words)
- Summarise the article in 2–3 sentences
- Give a clear recommendation
- End with: [Book a Zuddl demo](https://www.zuddl.com/demo)

---

## Tool data

${toolSummaries}

---

Target: ~2800 words. Return the complete article as markdown only — no preamble or commentary.`;
}

export function buildHumanizationPrompt(content: string): string {
  return `Review and improve this SEO article draft. Make it sound like it was written by a human expert, not AI.

CHANGES TO MAKE:
1. Replace any AI-ism phrases: "robust", "seamless", "leverage", "utilize", "it's worth noting", "cutting-edge", "delve", "game-changing", "in today's X landscape"
2. Vary sentence length — mix short punchy sentences with longer ones
3. Add one specific, concrete detail per tool section (e.g. a specific feature name, a customer type)
4. Remove any sentences that feel generic or could apply to any software
5. Ensure the tone is direct and practical throughout

IMPORTANT: Do NOT change the structure (H2s, H3s, tables, links). Only edit the prose.

Article to improve:
${content}

Return the improved article (full markdown).`;
}
