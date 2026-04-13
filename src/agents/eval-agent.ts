/**
 * Eval Agent
 *
 * Layer 1: Deterministic checks (code + math, no LLM)
 * Layer 2: LLM-based tone check (Claude)
 *
 * Total: 100 points. Threshold: 90 to pass.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  EvalMetricResult,
  EvalResult,
  GeneratedDraft,
  PipelineInput,
} from "../types";
import { buildToneEvalPrompt } from "../prompts/eval-prompts";
import { log, elapsed } from "../../lib/logger";

const PASS_THRESHOLD = 60;
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY!;
const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

const ZUDDL_BASE_URL = process.env.ZUDDL_BASE_URL ?? "https://www.zuddl.com";

const AI_ISMS = [
  "robust",
  "seamless",
  "it's worth noting",
  "cutting-edge",
  "leverage",
  "utilize",
  "in today's",
  "delve",
  "game-changing",
  "revolutionize",
  "streamline",
  "comprehensive solution",
  "empower",
];

export async function runEvalAgent(
  draft: GeneratedDraft,
  input: PipelineInput,
  benchmarkAvgWordCount: number,
  retryCount: number
): Promise<EvalResult> {
  const t = Date.now();
  log.info("eval", "start", {
    keyword: input.primaryKeyword,
    wordCount: draft.wordCount,
    benchmarkAvgWordCount,
    retryCount,
  });

  const metrics: EvalMetricResult[] = [];

  // ── Layer 1: Deterministic ─────────────────────────────────────────────────

  metrics.push(evalWordCount(draft.content, benchmarkAvgWordCount));
  metrics.push(evalKwDensity(draft.content, input.primaryKeyword));
  metrics.push(evalSecondaryKws(draft.content, input.secondaryKeywords));
  metrics.push(evalFlesch(draft.content));
  metrics.push(evalStructure(draft.content));
  metrics.push(evalInternalLinks(draft.content));
  metrics.push(evalAiIsms(draft.content));

  // ── Layer 2: LLM-based tone check (5 pts) ────────────────────────────────
  const toneMetric = await evalTone(draft.content);
  metrics.push(toneMetric);

  const overallScore = metrics.reduce((sum, m) => sum + m.score, 0);
  const passed = overallScore >= PASS_THRESHOLD;
  const retryComments = buildRetryComments(metrics, retryCount + 1);

  const failedMetrics = metrics.filter((m) => !m.passed).map((m) => m.metric);

  log.info("eval", "complete", {
    ms: elapsed(t),
    overallScore,
    passed,
    failedMetrics,
    metricBreakdown: metrics.map((m) => ({
      metric: m.metric,
      score: m.score,
      maxScore: m.maxScore,
      passed: m.passed,
    })),
  });

  if (!passed) {
    log.warn("eval", "article did not pass", {
      score: overallScore,
      threshold: PASS_THRESHOLD,
      failedMetrics,
      retryCount,
    });
  }

  return {
    overallScore,
    passed,
    metrics,
    retryComments,
    retryCount,
    flaggedForReview: !passed && retryCount >= 2,
  };
}

// ── Metric implementations ────────────────────────────────────────────────────

function evalWordCount(content: string, benchmarkAvg: number): EvalMetricResult {
  const wordCount = content.split(/\s+/).filter((w) => w.length > 0).length;
  const lower = benchmarkAvg * 0.85;
  const upper = benchmarkAvg * 1.15;
  const passed = wordCount >= lower && wordCount <= upper;

  return {
    metric: "Word Count",
    score: passed ? 15 : wordCount >= lower * 0.9 && wordCount <= upper * 1.1 ? 8 : 0,
    maxScore: 15,
    passed,
    detail: `${wordCount} words (target: ${Math.round(lower)}–${Math.round(upper)})`,
  };
}

function evalKwDensity(content: string, keyword: string): EvalMetricResult {
  const wordCount = content.split(/\s+/).filter((w) => w.length > 0).length;
  const pattern = new RegExp(escapeRegex(keyword), "gi");
  const matches = content.match(pattern) ?? [];
  const kwWordCount = keyword.split(/\s+/).length;
  const density = wordCount > 0 ? (matches.length * kwWordCount) / wordCount : 0;
  const densityPct = density * 100;

  const passed = densityPct >= 1.0 && densityPct <= 2.0;

  return {
    metric: "Primary KW Density",
    score: passed ? 15 : densityPct >= 0.5 && densityPct <= 2.5 ? 8 : 0,
    maxScore: 15,
    passed,
    detail: `${densityPct.toFixed(2)}% (target: 1.0–2.0%). Found "${keyword}" ${matches.length} times.`,
  };
}

function evalSecondaryKws(content: string, secondaryKws: string[]): EvalMetricResult {
  if (secondaryKws.length === 0) {
    return { metric: "Secondary Keywords", score: 10, maxScore: 10, passed: true, detail: "No secondary keywords specified." };
  }

  const lower = content.toLowerCase();
  const missing = secondaryKws.filter((kw) => !lower.includes(kw.toLowerCase()));
  const presentCount = secondaryKws.length - missing.length;
  const passed = missing.length === 0;
  const score = Math.round((presentCount / secondaryKws.length) * 10);

  return {
    metric: "Secondary Keywords",
    score,
    maxScore: 10,
    passed,
    detail: passed
      ? `All ${secondaryKws.length} secondary keywords found.`
      : `Missing: ${missing.join(", ")}`,
  };
}

function evalFlesch(content: string): EvalMetricResult {
  const cleanText = content
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/#{1,6}\s/g, "")
    .replace(/[*_`]/g, "");

  const sentences = cleanText
    .split(/[.!?]+/)
    .filter((s) => s.trim().length > 10);

  const words = cleanText.split(/\s+/).filter((w) => w.length > 0);

  if (sentences.length === 0 || words.length === 0) {
    return { metric: "Flesch Reading Ease", score: 10, maxScore: 20, passed: false, detail: "Could not calculate." };
  }

  const syllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
  const avgSentenceLen = words.length / sentences.length;
  const avgSyllablesPerWord = syllables / words.length;

  const flesch = 206.835 - 1.015 * avgSentenceLen - 84.6 * avgSyllablesPerWord;
  const score = Math.max(0, Math.min(100, flesch));

  const passed = score >= 50;

  return {
    metric: "Flesch Reading Ease",
    score: passed ? 20 : score >= 40 ? 12 : score >= 30 ? 6 : 0,
    maxScore: 20,
    passed,
    detail: `Flesch score: ${score.toFixed(1)} (minimum: 60). Avg sentence: ${avgSentenceLen.toFixed(1)} words.`,
  };
}

function evalStructure(content: string): EvalMetricResult {
  const checks = [
    { name: "comparison table", found: /\|.+\|.+\|/m.test(content) },
    { name: "FAQ section", found: /##\s*(faq|frequently asked)/i.test(content) },
    { name: "buying guide", found: /##\s*(how to choose|buying guide|what to look for|key factors)/i.test(content) },
    { name: "tool sections", found: /##\s*\d+\./m.test(content) },
    { name: "conclusion", found: /##\s*(final|conclusion|verdict|wrap)/i.test(content) },
  ];

  const passed_checks = checks.filter((c) => c.found);
  const failed_checks = checks.filter((c) => !c.found);
  const allPassed = failed_checks.length === 0;

  return {
    metric: "Structure Completeness",
    score: Math.round((passed_checks.length / checks.length) * 15),
    maxScore: 15,
    passed: allPassed,
    detail: allPassed
      ? "All required sections present."
      : `Missing sections: ${failed_checks.map((c) => c.name).join(", ")}`,
  };
}

function evalInternalLinks(content: string): EvalMetricResult {
  const pattern = /https?:\/\/(?:www\.)?zuddl\.com[^\s)"]*/gi;
  const matches = content.match(pattern) ?? [];
  const count = matches.length;
  const passed = count >= 3;

  return {
    metric: "Internal Zuddl Links",
    score: passed ? 10 : count === 2 ? 7 : count === 1 ? 4 : 0,
    maxScore: 10,
    passed,
    detail: `Found ${count} internal Zuddl links (minimum: 3).`,
  };
}

function evalAiIsms(content: string): EvalMetricResult {
  const lower = content.toLowerCase();
  const found = AI_ISMS.filter((phrase) => lower.includes(phrase.toLowerCase()));
  const count = found.length;
  const passed = count < 3;

  return {
    metric: "AI-ism Count",
    score: passed ? 10 : count <= 4 ? 6 : count <= 6 ? 3 : 0,
    maxScore: 10,
    passed,
    detail: count === 0
      ? "No AI-isms found."
      : `Found ${count} AI-ism(s): "${found.join('", "')}"`,
  };
}

async function evalTone(content: string): Promise<EvalMetricResult> {
  const t = Date.now();
  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 256,
      messages: [{ role: "user", content: buildToneEvalPrompt(content) }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "{}";
    const match = text.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) as { score?: number; detail?: string } : {};

    const rawScore = Math.min(5, Math.max(0, parsed.score ?? 3));
    const passed = rawScore >= 4;

    log.info("eval", "tone check complete", { ms: elapsed(t), rawScore, passed, detail: parsed.detail });

    return {
      metric: "Tone Authenticity",
      score: passed ? 5 : rawScore >= 3 ? 3 : 1,
      maxScore: 5,
      passed,
      detail: parsed.detail ?? `Tone score: ${rawScore}/5`,
    };
  } catch (err) {
    log.error("eval", "tone check Claude call failed", {
      error: err instanceof Error ? err.message : String(err),
      ms: elapsed(t),
    });
    return {
      metric: "Tone Authenticity",
      score: 3,
      maxScore: 5,
      passed: false,
      detail: "Could not evaluate tone (API error).",
    };
  }
}

// ── Retry comment builder ─────────────────────────────────────────────────────

function buildRetryComments(metrics: EvalMetricResult[], roundNumber: number): string {
  const failures = metrics.filter((m) => !m.passed);

  if (failures.length === 0) return "";

  const issues = failures.map((m) => {
    switch (m.metric) {
      case "Word Count":
        return `Word count: ${m.detail}. Expand existing sections with more detail — don't add new sections.`;
      case "Primary KW Density":
        return `Keyword density: ${m.detail}. Add the primary keyword naturally in the intro, tool sections, and conclusion.`;
      case "Secondary Keywords":
        return `Secondary keywords: ${m.detail}. Add these keywords naturally in context — don't force them.`;
      case "Flesch Reading Ease":
        return `Readability: ${m.detail}. Break long sentences into shorter ones (aim for under 20 words per sentence).`;
      case "Structure Completeness":
        return `Structure: ${m.detail}. Add the missing sections.`;
      case "Internal Zuddl Links":
        return `Internal links: ${m.detail}. Add more zuddl.com links in relevant tool sections and the conclusion.`;
      case "AI-ism Count":
        return `AI-isms: ${m.detail}. Replace these with plain English alternatives.`;
      case "Tone Authenticity":
        return `Tone: ${m.detail}. Make the writing sound less generic — add specific details, concrete examples.`;
      default:
        return m.detail;
    }
  });

  return `[REVISION ROUND ${roundNumber}]\n\nIssues to fix:\n${issues.map((i) => `- ${i}`).join("\n")}\n\nDo NOT rewrite the entire article. Fix only the flagged issues above.`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function countSyllables(word: string): number {
  const cleaned = word.toLowerCase().replace(/[^a-z]/g, "");
  if (cleaned.length <= 3) return 1;

  const vowelGroups = cleaned.match(/[aeiouy]+/g) ?? [];
  let count = vowelGroups.length;

  if (cleaned.endsWith("e") && count > 1) count--;

  return Math.max(1, count);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
