/**
 * Keyword Service Tests
 * Real MOZ API call — tests shape, types, and reasonable values.
 * Timeout: 30s (MOZ API is typically <5s)
 */

import { runKeywordService } from "@/src/services/keyword";
import { TEST_KEYWORD } from "../fixtures";

describe("Keyword Service (MOZ API)", () => {
  let result: Awaited<ReturnType<typeof runKeywordService>>;

  beforeAll(async () => {
    result = await runKeywordService(TEST_KEYWORD);
  }, 30_000);

  test("returns the correct primaryKeyword", () => {
    expect(result.primaryKeyword).toBe(TEST_KEYWORD);
  });

  test("difficulty is a number in range 0–100", () => {
    expect(typeof result.difficulty).toBe("number");
    expect(result.difficulty).toBeGreaterThanOrEqual(0);
    expect(result.difficulty).toBeLessThanOrEqual(100);
  });

  test("volume is a non-negative number", () => {
    expect(typeof result.volume).toBe("number");
    expect(result.volume).toBeGreaterThanOrEqual(0);
  });

  test("opportunity is in range 0–100", () => {
    expect(typeof result.opportunity).toBe("number");
    expect(result.opportunity).toBeGreaterThanOrEqual(0);
    expect(result.opportunity).toBeLessThanOrEqual(100);
  });

  test("intent is one of the valid values", () => {
    expect(["informational", "commercial", "navigational", "transactional"]).toContain(
      result.intent
    );
    // 'event management software' is a commercial intent query
    expect(result.intent).toBe("commercial");
  });

  test("relatedKeywords is an array (may be empty if MOZ returns nothing)", () => {
    expect(Array.isArray(result.relatedKeywords)).toBe(true);
  });

  test("each relatedKeyword has keyword, volume, difficulty", () => {
    for (const rk of result.relatedKeywords) {
      expect(typeof rk.keyword).toBe("string");
      expect(rk.keyword.length).toBeGreaterThan(0);
      expect(typeof rk.volume).toBe("number");
      expect(typeof rk.difficulty).toBe("number");
    }
  });
});
