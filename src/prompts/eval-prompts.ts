import type { EvalMetricResult } from "../types";

export function buildToneEvalPrompt(content: string): string {
  return `Evaluate this SEO article excerpt for tone authenticity. Does it sound like a human expert wrote it, or does it sound like AI-generated content?

Article excerpt (first 1500 words):
${content.slice(0, 3000)}

Respond with ONLY a JSON object:
{
  "score": <number 0-5, where 5 = clearly human, 0 = clearly AI>,
  "detail": "<one sentence explaining the score>"
}`;
}

// ─── Escalating revision prompts ─────────────────────────────────────────────

/**
 * Round 0: Targeted fix — address each failing metric directly.
 * Strategy: fix issues without touching passing sections.
 */
export function buildRevisionPromptRound0(
  metrics: EvalMetricResult[],
  currentScore: number
): string {
  const failures = metrics.filter((m) => !m.passed);
  const passing = metrics.filter((m) => m.passed).map((m) => m.metric);

  const instructions = failures.map((m) => {
    switch (m.metric) {
      case "Word Count":
        return buildWordCountInstruction(m.detail);
      case "Primary KW Density":
        return buildKwDensityInstruction(m.detail);
      case "Secondary Keywords":
        return `SECONDARY KEYWORDS: ${m.detail}\n→ Add each missing keyword naturally in context — once per missing keyword is enough.`;
      case "Flesch Reading Ease":
        return `READABILITY: ${m.detail}\n→ Find sentences over 20 words and break them into two at a natural pause or conjunction. Target: average sentence length under 18 words.`;
      case "Structure Completeness":
        return `STRUCTURE: ${m.detail}\n→ Add the missing section(s). Use the correct H2 heading pattern (e.g. "## How to Choose..." for buying guide, "## Frequently Asked Questions" for FAQ).`;
      case "Internal Zuddl Links":
        return `INTERNAL LINKS: ${m.detail}\n→ Add more zuddl.com links. Natural places: Zuddl tool section, buying guide CTA, conclusion. Use [anchor text](https://www.zuddl.com/...) format.`;
      case "AI-ism Count":
        return `AI-ISMS: ${m.detail}\n→ Find and replace EVERY instance. Use plain English: "works well" instead of "robust", "easy to use" instead of "seamless", "use" instead of "leverage" or "utilize".`;
      case "Tone Authenticity":
        return `TONE: ${m.detail}\n→ Add one concrete, specific detail per tool section (a real feature name, a specific use case, a tangible outcome). Remove any sentence that could apply to any software generically.`;
      default:
        return `${m.metric}: ${m.detail}`;
    }
  });

  return `[REVISION 1 of 3 — Score: ${currentScore}/100]

These metrics failed. Fix them one by one. Do NOT touch sections that already passed.

PASSING (do not change): ${passing.join(", ")}

FAILING — fix each one:
${instructions.map((i) => `\n${i}`).join("\n")}

Rules:
- Keep all H2/H3 headings, comparison table, and all links exactly as-is
- Only edit prose paragraphs and body text
- Do not add new H2 sections or reorder tools
- Return the complete revised article (full markdown)`;
}

/**
 * Round 1: Surgical with exact numbers.
 * Strategy: precise measurements, exact word targets, line-by-line instructions.
 */
export function buildRevisionPromptRound1(
  metrics: EvalMetricResult[],
  currentScore: number,
  wordCount: number,
  benchmarkAvgWordCount: number
): string {
  const failures = metrics.filter((m) => !m.passed);

  const instructions = failures.map((m) => {
    switch (m.metric) {
      case "Word Count": {
        const lower = Math.round(benchmarkAvgWordCount * 0.85);
        const upper = Math.round(benchmarkAvgWordCount * 1.15);
        if (wordCount > upper) {
          const excess = wordCount - upper;
          return `WORD COUNT — Cut exactly ${excess} words (currently ${wordCount}, target max ${upper}):
→ Trim buying guide: cut the intro paragraph by half, remove one of the 5 criteria sections entirely
→ Trim FAQ: shorten each answer to 2 sentences maximum
→ Trim each tool section: cut the "Best For" paragraph to 1 sentence
→ Do NOT cut the comparison table, Zuddl section, or conclusion`;
        } else {
          const deficit = lower - wordCount;
          return `WORD COUNT — Add ${deficit} words (currently ${wordCount}, target min ${lower}):
→ Add 1–2 sentences to each tool's "Best For" subsection with a specific use case
→ Expand the buying guide intro by 1 paragraph`;
        }
      }
      case "Primary KW Density": {
        const densityMatch = m.detail.match(/([\d.]+)%/);
        const currentDensity = densityMatch ? parseFloat(densityMatch[1]) : 0;
        if (currentDensity < 1.0) {
          return `KW DENSITY — Too low (${currentDensity.toFixed(2)}%, need 1–2%):
→ Add the primary keyword in: (1) the first paragraph of the intro, (2) the Zuddl section opening sentence, (3) the buying guide H2 heading, (4) the conclusion first sentence
→ Use the exact phrase, not a variation`;
        } else {
          return `KW DENSITY — Too high (${currentDensity.toFixed(2)}%, need 1–2%):
→ In tool sections 4–10, replace some uses of the primary keyword with "the platform", "this tool", "it", or "the software"
→ Remove it from any bullet points where it feels forced`;
        }
      }
      case "Flesch Reading Ease": {
        const fleschMatch = m.detail.match(/score: ([\d.]+)/i);
        const flesch = fleschMatch ? parseFloat(fleschMatch[1]) : 0;
        const sentLenMatch = m.detail.match(/Avg sentence: ([\d.]+)/i);
        const avgLen = sentLenMatch ? parseFloat(sentLenMatch[1]) : 0;
        return `READABILITY — Flesch ${flesch.toFixed(1)} (need ≥60), avg sentence ${avgLen.toFixed(1)} words (need <18):
→ Go through EVERY paragraph in the article body
→ For ANY sentence over 20 words: split it at the main conjunction (and, but, which, that, because) into two sentences
→ Aim: no sentence should exceed 22 words
→ Do not change bullet points or table rows — only paragraph prose`;
      }
      case "AI-ism Count":
        return `AI-ISMS: ${m.detail}
→ Do a find-and-replace pass on the ENTIRE article for each flagged phrase
→ Do not just remove them — replace with plain, specific language`;
      case "Internal Zuddl Links":
        return `ZUDDL LINKS: ${m.detail}
→ Add links to: https://www.zuddl.com/demo (in conclusion CTA), https://www.zuddl.com/features (in Zuddl section), https://www.zuddl.com (in intro where Zuddl is first mentioned)`;
      default:
        return `${m.metric}: ${m.detail} → Fix this specifically.`;
    }
  });

  return `[REVISION 2 of 3 — Score: ${currentScore}/100]

The previous revision did not fully fix these issues. Follow these exact instructions:

${instructions.map((i) => `\n${i}`).join("\n")}

Be surgical. Do not change anything that is working.
Return the complete revised article (full markdown).`;
}

/**
 * Round 2: Hard constraints — final chance.
 * Strategy: treat targets as non-negotiable constraints, rewrite failing sections entirely if needed.
 */
export function buildRevisionPromptRound2(
  metrics: EvalMetricResult[],
  currentScore: number,
  wordCount: number,
  benchmarkAvgWordCount: number
): string {
  const failures = metrics.filter((m) => !m.passed);
  const lower = Math.round(benchmarkAvgWordCount * 0.85);
  const upper = Math.round(benchmarkAvgWordCount * 1.15);

  const constraints = failures.map((m) => {
    switch (m.metric) {
      case "Word Count":
        return `- Word count: MUST be ${lower}–${upper} words (currently ${wordCount}). ${wordCount > upper ? `Cut ${wordCount - upper} words — delete entire paragraphs from buying guide if needed.` : `Add ${lower - wordCount} words.`}`;
      case "Flesch Reading Ease": {
        const match = m.detail.match(/Avg sentence: ([\d.]+)/i);
        return `- Readability: MUST achieve Flesch ≥ 60. Every sentence MUST be under 20 words. Current avg: ${match?.[1] ?? "?"} words/sentence. Rewrite entire paragraphs if needed — do not just split one sentence here and there.`;
      }
      case "Primary KW Density": {
        const match = m.detail.match(/([\d.]+)%/);
        return `- Keyword density: MUST be 1.0–2.0% (currently ${match?.[1] ?? "?"}%). Adjust occurrences accordingly.`;
      }
      case "Secondary Keywords":
        return `- Secondary keywords: ${m.detail} MUST appear at least once each.`;
      case "Structure Completeness":
        return `- Structure: ${m.detail} MUST be added.`;
      case "Internal Zuddl Links":
        return `- Zuddl links: MUST have ≥ 3 links to zuddl.com in the article.`;
      case "AI-ism Count":
        return `- AI-isms: MUST have fewer than 3 instances of banned phrases. Check every sentence.`;
      case "Tone Authenticity":
        return `- Tone: MUST read as expert human writing. Rewrite generic sentences with specific, concrete details.`;
      default:
        return `- ${m.metric}: ${m.detail}`;
    }
  });

  const failedNames = failures.map((m) => m.metric).join(", ");

  return `[REVISION 3 of 3 — FINAL CHANCE — Score: ${currentScore}/100]

This article has failed quality checks twice. If it fails again, it will be flagged for manual review.

Still failing: ${failedNames}

These constraints are NON-NEGOTIABLE. The article will not pass without meeting all of them:

${constraints.join("\n")}

Instructions:
1. Address EACH constraint above — work through them one at a time
2. Rewrite entire sections if that is what it takes (especially for readability and word count)
3. Do not add new H2 sections or change the tool order
4. Every link in the original must still be present

Return the complete revised article (full markdown). This is the final revision.`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildWordCountInstruction(detail: string): string {
  const match = detail.match(/(\d+) words.*target: (\d+)[–-](\d+)/i);
  if (!match) return `WORD COUNT: ${detail}\n→ Adjust the word count to meet the target range.`;

  const current = parseInt(match[1]);
  const lower = parseInt(match[2]);
  const upper = parseInt(match[3]);

  if (current > upper) {
    return `WORD COUNT: ${detail}
→ The article is ${current - upper} words too long. Cut from: (1) buying guide — trim each criterion paragraph to 3 sentences max, (2) FAQ — each answer to 2–3 sentences max. Do NOT cut tool sections.`;
  }
  return `WORD COUNT: ${detail}
→ The article is ${lower - current} words too short. Add 1 sentence per tool section "Best For" and expand the buying guide intro.`;
}

function buildKwDensityInstruction(detail: string): string {
  const match = detail.match(/([\d.]+)%/);
  const density = match ? parseFloat(match[1]) : 0;
  if (density < 1.0) {
    return `KW DENSITY: ${detail}\n→ Add the primary keyword 3–4 more times naturally: once in the intro, once in the buying guide, once in the conclusion. Use the full exact phrase.`;
  }
  return `KW DENSITY: ${detail}\n→ The keyword appears too often. In tool sections 5–10, replace it with pronouns or synonyms ("the platform", "this tool", "it").`;
}
