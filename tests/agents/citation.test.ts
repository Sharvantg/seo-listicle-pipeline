/**
 * Citation Agent Tests
 * Real Claude + GPT-4o calls via Vercel AI Gateway.
 * Tests AEO insight parsing — the AI-as-a-user pattern.
 * Timeout: 2 min (two parallel LLM calls)
 */

import { runCitationAgent } from "@/src/agents/citation-agent";
import { TEST_KEYWORD } from "../fixtures";

describe("Citation Agent (AEO — Claude + GPT-4o)", () => {
  let result: Awaited<ReturnType<typeof runCitationAgent>>;

  beforeAll(async () => {
    result = await runCitationAgent(TEST_KEYWORD);
  }, 120_000);

  test("aiInsights contains at least one model response", () => {
    expect(Array.isArray(result.aiInsights)).toBe(true);
    expect(result.aiInsights.length).toBeGreaterThanOrEqual(1);
  });

  test("each insight has a model identifier", () => {
    for (const insight of result.aiInsights) {
      expect(typeof insight.model).toBe("string");
      expect(insight.model.length).toBeGreaterThan(0);
    }
  });

  test("each insight has toolsMentioned with at least 3 tools", () => {
    for (const insight of result.aiInsights) {
      expect(Array.isArray(insight.toolsMentioned)).toBe(true);
      expect(insight.toolsMentioned.length).toBeGreaterThanOrEqual(3);

      for (const tool of insight.toolsMentioned) {
        expect(typeof tool.name).toBe("string");
        expect(tool.name.length).toBeGreaterThan(0);
        expect(typeof tool.rank).toBe("number");
        expect(tool.rank).toBeGreaterThan(0);
      }
    }
  });

  test("each insight has sourcesReferenced array", () => {
    for (const insight of result.aiInsights) {
      expect(Array.isArray(insight.sourcesReferenced)).toBe(true);
    }
  });

  test("each insight has keyInsights array with content", () => {
    for (const insight of result.aiInsights) {
      expect(Array.isArray(insight.keyInsights)).toBe(true);
      expect(insight.keyInsights.length).toBeGreaterThan(0);
    }
  });

  test("each insight has a rawResponse string", () => {
    for (const insight of result.aiInsights) {
      expect(typeof insight.rawResponse).toBe("string");
      expect(insight.rawResponse.length).toBeGreaterThan(100);
    }
  });

  test("consensusTools is an array (tools both models agree on)", () => {
    expect(Array.isArray(result.consensusTools)).toBe(true);
    // May be empty if only one model responded, otherwise should have common tools
  });

  test("domains is an array of strings", () => {
    expect(Array.isArray(result.domains)).toBe(true);
    for (const d of result.domains) {
      expect(typeof d).toBe("string");
    }
  });

  test("tools mentioned include well-known event management platforms", () => {
    const allToolNames = result.aiInsights
      .flatMap((i) => i.toolsMentioned)
      .map((t) => t.name.toLowerCase());

    // At least one well-known tool should be mentioned
    const knownTools = ["cvent", "eventbrite", "hopin", "bizzabo", "whova", "swoogo", "splash"];
    const hasKnownTool = knownTools.some((t) => allToolNames.some((n) => n.includes(t)));
    expect(hasKnownTool).toBe(true);
  });
});
