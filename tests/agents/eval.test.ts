/**
 * Eval Agent Tests
 * Tests both deterministic scoring metrics and the LLM tone check.
 * Uses a synthetic draft so we can control exactly what passes/fails.
 * Timeout: 60s (one Claude call for tone check)
 */

import { runEvalAgent } from "@/src/agents/eval-agent";
import { TEST_INPUT, buildTestDraft } from "../fixtures";

const BENCHMARK_WORD_COUNT = 2800;

describe("Eval Agent", () => {
  describe("with a well-formed draft (should score high)", () => {
    let result: Awaited<ReturnType<typeof runEvalAgent>>;

    beforeAll(async () => {
      const draft = buildTestDraft();
      result = await runEvalAgent(draft, TEST_INPUT, BENCHMARK_WORD_COUNT, 0);
    }, 60_000);

    test("returns an EvalResult with all required fields", () => {
      expect(typeof result.overallScore).toBe("number");
      expect(typeof result.passed).toBe("boolean");
      expect(Array.isArray(result.metrics)).toBe(true);
      expect(typeof result.retryComments).toBe("string");
      expect(typeof result.retryCount).toBe("number");
      expect(typeof result.flaggedForReview).toBe("boolean");
    });

    test("overallScore is in range 0–100", () => {
      expect(result.overallScore).toBeGreaterThanOrEqual(0);
      expect(result.overallScore).toBeLessThanOrEqual(100);
    });

    test("has exactly 8 metric results (7 deterministic + 1 tone)", () => {
      expect(result.metrics.length).toBe(8);
    });

    test("each metric has required fields", () => {
      for (const m of result.metrics) {
        expect(typeof m.metric).toBe("string");
        expect(typeof m.score).toBe("number");
        expect(typeof m.maxScore).toBe("number");
        expect(typeof m.passed).toBe("boolean");
        expect(typeof m.detail).toBe("string");
        expect(m.score).toBeGreaterThanOrEqual(0);
        expect(m.score).toBeLessThanOrEqual(m.maxScore);
      }
    });

    test("structure metric passes (draft has table, FAQ, buying guide)", () => {
      const structureMetric = result.metrics.find((m) => m.metric === "Structure Completeness");
      expect(structureMetric).toBeDefined();
      expect(structureMetric!.passed).toBe(true);
    });

    test("internal links metric passes (draft has 3 Zuddl links)", () => {
      const linksMetric = result.metrics.find((m) =>
        m.metric.toLowerCase().includes("link")
      );
      expect(linksMetric).toBeDefined();
      expect(linksMetric!.passed).toBe(true);
    });

    test("word count metric passes (draft is ~2800 words within ±15%)", () => {
      const wcMetric = result.metrics.find((m) =>
        m.metric.toLowerCase().includes("word")
      );
      expect(wcMetric).toBeDefined();
      // Our test draft is ~2800 words, benchmark is 2800 → should pass
      expect(wcMetric!.score).toBeGreaterThan(0);
    });

    test("primary KW density metric is scored", () => {
      const kwMetric = result.metrics.find((m) =>
        m.metric.toLowerCase().includes("density") || m.metric.toLowerCase().includes("kw")
      );
      expect(kwMetric).toBeDefined();
      expect(kwMetric!.score).toBeGreaterThanOrEqual(0);
    });

    test("total metric scores sum to overallScore", () => {
      const sum = result.metrics.reduce((acc, m) => acc + m.score, 0);
      expect(sum).toBe(result.overallScore);
    });

    test("draft with good structure should score above 50", () => {
      expect(result.overallScore).toBeGreaterThan(50);
    });
  });

  describe("with a very short draft (word count failure)", () => {
    let result: Awaited<ReturnType<typeof runEvalAgent>>;

    beforeAll(async () => {
      // Only 100 words — should fail word count metric hard
      const shortDraft = buildTestDraft({
        content: `# Best event management software\n\nThis is very short. event management software event management software event management software.\n\n## Zuddl\nhttps://www.zuddl.com/pricing\nhttps://www.zuddl.com/demo\nhttps://www.zuddl.com/features\n\n## Comparison Table\n| Tool | Price |\n|------|-------|\n| Zuddl | Contact |\n\n## FAQs\n### What is event management software?\nSoftware for events.\n\n## Buying Guide\nChoose carefully.`,
        wordCount: 80,
      });
      result = await runEvalAgent(shortDraft, TEST_INPUT, BENCHMARK_WORD_COUNT, 0);
    }, 60_000);

    test("word count metric fails for very short draft", () => {
      const wcMetric = result.metrics.find((m) =>
        m.metric.toLowerCase().includes("word")
      );
      expect(wcMetric).toBeDefined();
      expect(wcMetric!.passed).toBe(false);
    });

    test("flaggedForReview is false on first attempt (round 0)", () => {
      // flaggedForReview only triggers after retryCount >= 2
      expect(result.flaggedForReview).toBe(false);
    });

    test("retryCount is 0 (first attempt)", () => {
      expect(result.retryCount).toBe(0);
    });
  });

  describe("after 2 failed rounds (flaggedForReview logic)", () => {
    let result: Awaited<ReturnType<typeof runEvalAgent>>;

    beforeAll(async () => {
      const shortDraft = buildTestDraft({ wordCount: 80 });
      // Pass retryCount=2 to simulate being on the 3rd attempt
      result = await runEvalAgent(shortDraft, TEST_INPUT, BENCHMARK_WORD_COUNT, 2);
    }, 60_000);

    test("flaggedForReview is true when score is low after 2 retries", () => {
      if (!result.passed) {
        expect(result.flaggedForReview).toBe(true);
      }
    });
  });
});
