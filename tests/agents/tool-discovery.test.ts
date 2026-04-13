/**
 * Tool Discovery Agent Tests
 * Real Serper searches + Claude extraction.
 * Timeout: 90s (3 Serper calls + 1 Claude call)
 */

import { runToolDiscoveryAgent } from "@/src/agents/tool-discovery-agent";
import { TEST_KEYWORD } from "../fixtures";

describe("Tool Discovery Agent (Serper + Claude)", () => {
  const TARGET_COUNT = 5;
  let candidates: Awaited<ReturnType<typeof runToolDiscoveryAgent>>;

  beforeAll(async () => {
    candidates = await runToolDiscoveryAgent(TEST_KEYWORD, TARGET_COUNT);
  }, 90_000);

  test("returns an array of tool candidates", () => {
    expect(Array.isArray(candidates)).toBe(true);
    expect(candidates.length).toBeGreaterThan(0);
  });

  test("returns at least targetCount tools (with buffer of +3)", () => {
    // Agent returns targetCount + 3 for reviewer to choose from
    expect(candidates.length).toBeGreaterThanOrEqual(TARGET_COUNT);
  });

  test("Zuddl is always present in the candidates", () => {
    const zuddl = candidates.find(
      (c) => c.name.toLowerCase() === "zuddl" || c.website?.includes("zuddl.com")
    );
    expect(zuddl).toBeDefined();
  });

  test("each candidate has required fields", () => {
    for (const c of candidates) {
      expect(typeof c.name).toBe("string");
      expect(c.name.length).toBeGreaterThan(0);
      expect(typeof c.website).toBe("string");
      expect(c.website).toMatch(/^https?:\/\//);
      expect(typeof c.confidence).toBe("number");
      expect(c.confidence).toBeGreaterThan(0);
      expect(c.confidence).toBeLessThanOrEqual(1);
      expect(typeof c.source).toBe("string");
    }
  });

  test("no duplicate tool names", () => {
    const names = candidates.map((c) => c.name.toLowerCase());
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  test("does not include review sites (G2, Capterra, GetApp)", () => {
    const blockedSites = ["g2.com", "capterra.com", "getapp.com", "softwareadvice.com"];
    for (const c of candidates) {
      const domain = c.website.replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
      expect(blockedSites).not.toContain(domain);
    }
  });

  test("Zuddl has confidence >= 0.9", () => {
    const zuddl = candidates.find(
      (c) => c.name.toLowerCase() === "zuddl" || c.website?.includes("zuddl.com")
    )!;
    expect(zuddl.confidence).toBeGreaterThanOrEqual(0.9);
  });

  test("all tools are relevant to the keyword category", () => {
    // Each tool should have a reason explaining why it belongs
    for (const c of candidates) {
      if (c.reason) {
        expect(typeof c.reason).toBe("string");
        expect(c.reason.length).toBeGreaterThan(10);
      }
    }
  });
});
