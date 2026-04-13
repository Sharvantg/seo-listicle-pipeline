/**
 * Revision Agent Tests
 * Tests all 3 escalating revision strategies with real Claude calls.
 * Timeout: 5 min per test (Claude max_tokens 8000)
 */

import { runRevisionAgent } from "@/src/agents/revision-agent";
import { runEvalAgent } from "@/src/agents/eval-agent";
import { TEST_INPUT, MINIMAL_RESEARCH, buildTestDraft } from "../fixtures";
import { randomUUID } from "crypto";

const BENCHMARK_WORD_COUNT = 2800;

// Build an eval result from a draft so we have something to revise against
async function getEvalResult(draft: ReturnType<typeof buildTestDraft>) {
  return runEvalAgent(draft, TEST_INPUT, BENCHMARK_WORD_COUNT, 0);
}

describe("Revision Agent (Claude)", () => {
  describe("Round 0 — targeted fix strategy", () => {
    let revisedDraft: Awaited<ReturnType<typeof runRevisionAgent>>;
    const originalDraft = buildTestDraft();
    const runId = randomUUID();

    beforeAll(async () => {
      const evalResult = await getEvalResult(originalDraft);
      revisedDraft = await runRevisionAgent(
        originalDraft,
        evalResult,
        TEST_INPUT,
        MINIMAL_RESEARCH,
        0,
        BENCHMARK_WORD_COUNT,
        runId
      );
    }, 5 * 60_000);

    test("returns a GeneratedDraft with all required fields", () => {
      expect(typeof revisedDraft.title).toBe("string");
      expect(typeof revisedDraft.content).toBe("string");
      expect(typeof revisedDraft.wordCount).toBe("number");
      expect(typeof revisedDraft.slug).toBe("string");
    });

    test("revised content is non-empty and substantial", () => {
      expect(revisedDraft.content.length).toBeGreaterThan(500);
    });

    test("wordCount matches actual content word count", () => {
      const actual = revisedDraft.content.split(/\s+/).filter((w) => w.length > 0).length;
      expect(Math.abs(revisedDraft.wordCount - actual)).toBeLessThan(50);
    });

    test("metadata (title, slug, jsonLd) is preserved from original", () => {
      expect(revisedDraft.title).toBe(originalDraft.title);
      expect(revisedDraft.slug).toBe(originalDraft.slug);
      expect(revisedDraft.jsonLd).toBe(originalDraft.jsonLd);
    });

    test("Zuddl is still present in the revised content", () => {
      expect(revisedDraft.content.toLowerCase()).toContain("zuddl");
    });
  });

  describe("Round 1 — surgical revision strategy", () => {
    let revisedDraft: Awaited<ReturnType<typeof runRevisionAgent>>;
    const originalDraft = buildTestDraft();
    const runId = randomUUID();

    beforeAll(async () => {
      const evalResult = await getEvalResult(originalDraft);
      revisedDraft = await runRevisionAgent(
        originalDraft,
        evalResult,
        TEST_INPUT,
        MINIMAL_RESEARCH,
        1,
        BENCHMARK_WORD_COUNT,
        runId
      );
    }, 5 * 60_000);

    test("returns valid draft for round 1", () => {
      expect(revisedDraft.content.length).toBeGreaterThan(500);
      expect(typeof revisedDraft.wordCount).toBe("number");
    });
  });

  describe("Round 2 — hard constraints strategy", () => {
    let revisedDraft: Awaited<ReturnType<typeof runRevisionAgent>>;
    const originalDraft = buildTestDraft();
    const runId = randomUUID();

    beforeAll(async () => {
      const evalResult = await getEvalResult(originalDraft);
      revisedDraft = await runRevisionAgent(
        originalDraft,
        evalResult,
        TEST_INPUT,
        MINIMAL_RESEARCH,
        2,
        BENCHMARK_WORD_COUNT,
        runId
      );
    }, 5 * 60_000);

    test("returns valid draft for round 2", () => {
      expect(revisedDraft.content.length).toBeGreaterThan(500);
      expect(typeof revisedDraft.wordCount).toBe("number");
    });

    test("Zuddl still present after hard constraints revision", () => {
      expect(revisedDraft.content.toLowerCase()).toContain("zuddl");
    });
  });
});
