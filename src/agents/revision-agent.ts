/**
 * Revision Agent
 * Single Claude call to revise an article based on eval feedback.
 * Extracted from /api/eval/revise/route.ts to live server-side in the pipeline runner.
 */

import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt } from "../prompts/system-prompt";
import {
  buildRevisionPromptRound0,
  buildRevisionPromptRound1,
  buildRevisionPromptRound2,
} from "../prompts/eval-prompts";
import { saveRevisionTrace } from "../../lib/pipeline-store";
import type { EvalResult, GeneratedDraft, PipelineInput, ResearchSynthesis } from "../types";
import { log, elapsed } from "../../lib/logger";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY! });

export async function runRevisionAgent(
  draft: GeneratedDraft,
  evalResult: EvalResult,
  input: PipelineInput,
  research: ResearchSynthesis,
  round: number,
  benchmarkAvgWordCount: number,
  runId: string
): Promise<GeneratedDraft> {
  const t = Date.now();

  const strategyLabels: Record<number, string> = {
    0: "targeted",
    1: "surgical",
    2: "hard_constraints",
  };
  const strategy = strategyLabels[round] ?? "hard_constraints";

  log.info("revision-agent", "start", {
    keyword: input.primaryKeyword,
    round,
    strategy,
    currentScore: evalResult.overallScore,
    wordCount: draft.wordCount,
    failedMetrics: evalResult.metrics.filter((m) => !m.passed).map((m) => m.metric),
    runId,
  });

  let revisionPrompt: string;
  switch (round) {
    case 0:
      revisionPrompt = buildRevisionPromptRound0(evalResult.metrics, evalResult.overallScore);
      break;
    case 1:
      revisionPrompt = buildRevisionPromptRound1(
        evalResult.metrics,
        evalResult.overallScore,
        draft.wordCount,
        benchmarkAvgWordCount
      );
      break;
    default:
      revisionPrompt = buildRevisionPromptRound2(
        evalResult.metrics,
        evalResult.overallScore,
        draft.wordCount,
        benchmarkAvgWordCount
      );
  }

  const systemPrompt = buildSystemPrompt(input, research);

  const tClaude = Date.now();
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8000,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `${revisionPrompt}\n\nHere is the article to revise:\n\n${draft.content}`,
      },
    ],
  });

  const revisedContent =
    response.content[0].type === "text" ? response.content[0].text : draft.content;

  const wordCount = revisedContent.split(/\s+/).filter((w) => w.length > 0).length;

  const revisedDraft: GeneratedDraft = {
    ...draft,
    content: revisedContent,
    wordCount,
  };

  log.info("revision-agent", "Claude revision complete", {
    ms: elapsed(tClaude),
    strategy,
    beforeWords: draft.wordCount,
    afterWords: wordCount,
  });

  // Fire-and-forget trace save
  saveRevisionTrace(runId, round, revisionPrompt, revisedDraft).catch((err) =>
    log.error("revision-agent", "trace save failed", {
      error: err instanceof Error ? err.message : String(err),
      runId,
      round,
    })
  );

  log.info("revision-agent", "complete", { ms: elapsed(t), round, strategy });

  return revisedDraft;
}
