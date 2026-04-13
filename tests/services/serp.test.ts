/**
 * SERP Service Tests
 * Real Serper API call — tests shape, types, and content quality.
 * Timeout: 20s (Serper is ~500ms)
 */

import { runSerpService } from "@/src/services/serp";
import { TEST_KEYWORD } from "../fixtures";

describe("SERP Service (Serper API)", () => {
  let result: Awaited<ReturnType<typeof runSerpService>>;

  beforeAll(async () => {
    result = await runSerpService(TEST_KEYWORD);
  }, 20_000);

  test("topResults is a non-empty array (up to 5)", () => {
    expect(Array.isArray(result.topResults)).toBe(true);
    expect(result.topResults.length).toBeGreaterThan(0);
    expect(result.topResults.length).toBeLessThanOrEqual(5);
  });

  test("each topResult has required fields", () => {
    for (const r of result.topResults) {
      expect(typeof r.title).toBe("string");
      expect(r.title.length).toBeGreaterThan(0);
      expect(typeof r.url).toBe("string");
      expect(r.url).toMatch(/^https?:\/\//);
      expect(typeof r.domain).toBe("string");
      expect(r.domain.length).toBeGreaterThan(0);
      expect(typeof r.snippet).toBe("string");
      expect(typeof r.position).toBe("number");
      expect(r.position).toBeGreaterThan(0);
    }
  });

  test("linkedDomains is an array of non-empty strings", () => {
    expect(Array.isArray(result.linkedDomains)).toBe(true);
    for (const d of result.linkedDomains) {
      expect(typeof d).toBe("string");
      expect(d.length).toBeGreaterThan(0);
      // Domains should not include the protocol
      expect(d).not.toMatch(/^https?:\/\//);
    }
  });

  test("linkedDomains does not include zuddl.com (filtered out)", () => {
    expect(result.linkedDomains.every((d) => !d.includes("zuddl.com"))).toBe(true);
  });

  test("commonTopics is an array of strings", () => {
    expect(Array.isArray(result.commonTopics)).toBe(true);
    for (const t of result.commonTopics) {
      expect(typeof t).toBe("string");
      // Topics are 4+ character words (from the extractCommonTopics filter)
      expect(t.length).toBeGreaterThanOrEqual(4);
    }
  });

  test("results are ordered by position", () => {
    const positions = result.topResults.map((r) => r.position);
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });
});
