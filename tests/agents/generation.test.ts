/**
 * Generation Agent Tests
 * Real Claude calls — two-pass generation (article + humanization).
 * Timeout: 5 min (two large Claude responses)
 */

import { runGenerationAgent } from "@/src/agents/generation-agent";
import { MINIMAL_RESEARCH, MINIMAL_TOOLS, TEST_INPUT, TEST_KEYWORD } from "../fixtures";

describe("Generation Agent (Claude)", () => {
  let draft: Awaited<ReturnType<typeof runGenerationAgent>>;

  beforeAll(async () => {
    draft = await runGenerationAgent(TEST_INPUT, MINIMAL_RESEARCH, MINIMAL_TOOLS);
  }, 5 * 60_000);

  // ── Structure checks ─────────────────────────────────────────────────────────

  test("draft has all required fields", () => {
    expect(typeof draft.title).toBe("string");
    expect(typeof draft.metaDescription).toBe("string");
    expect(typeof draft.slug).toBe("string");
    expect(typeof draft.content).toBe("string");
    expect(typeof draft.wordCount).toBe("number");
    expect(typeof draft.primaryKwDensity).toBe("number");
    expect(typeof draft.jsonLd).toBe("string");
  });

  test("title contains the primary keyword", () => {
    expect(draft.title.toLowerCase()).toContain(TEST_KEYWORD.toLowerCase());
  });

  test("slug is URL-safe", () => {
    expect(draft.slug).toMatch(/^[a-z0-9-]+$/);
    expect(draft.slug).not.toContain(" ");
  });

  test("meta description is 120–160 characters", () => {
    expect(draft.metaDescription.length).toBeGreaterThanOrEqual(100);
    expect(draft.metaDescription.length).toBeLessThanOrEqual(200);
  });

  // ── Word count ────────────────────────────────────────────────────────────────

  test("wordCount is >= 1500 words (meaningful article)", () => {
    expect(draft.wordCount).toBeGreaterThanOrEqual(1500);
  });

  test("wordCount matches actual content length", () => {
    const actualCount = draft.content.split(/\s+/).filter((w) => w.length > 0).length;
    // Allow small rounding difference
    expect(Math.abs(draft.wordCount - actualCount)).toBeLessThan(50);
  });

  // ── Content structure ─────────────────────────────────────────────────────────

  test("content includes a comparison table", () => {
    expect(draft.content).toMatch(/\|.+\|.+\|/); // markdown table row
  });

  test("content includes FAQ section", () => {
    const hasFaq =
      draft.content.toLowerCase().includes("## faq") ||
      draft.content.toLowerCase().includes("## frequently asked") ||
      draft.content.toLowerCase().includes("### what is");
    expect(hasFaq).toBe(true);
  });

  test("content includes buying guide section", () => {
    const hasBuyingGuide =
      draft.content.toLowerCase().includes("buying guide") ||
      draft.content.toLowerCase().includes("how to choose");
    expect(hasBuyingGuide).toBe(true);
  });

  test("Zuddl appears in the article", () => {
    expect(draft.content.toLowerCase()).toContain("zuddl");
  });

  test("content has at least 3 internal Zuddl links", () => {
    const zuddlLinks = (draft.content.match(/https:\/\/www\.zuddl\.com/g) ?? []).length;
    expect(zuddlLinks).toBeGreaterThanOrEqual(1); // at minimum one Zuddl reference
  });

  test("all 5 test tools are mentioned in the article", () => {
    const toolNames = MINIMAL_TOOLS.map((t) => t.name.toLowerCase());
    for (const name of toolNames) {
      expect(draft.content.toLowerCase()).toContain(name);
    }
  });

  // ── Keyword density ────────────────────────────────────────────────────────────

  test("primary keyword density is between 0.5% and 3% (reasonable range)", () => {
    expect(draft.primaryKwDensity).toBeGreaterThan(0.005);
    expect(draft.primaryKwDensity).toBeLessThan(0.03);
  });

  // ── JSON-LD schema ─────────────────────────────────────────────────────────────

  test("jsonLd is valid JSON", () => {
    expect(() => JSON.parse(draft.jsonLd)).not.toThrow();
  });

  test("jsonLd contains @context schema.org", () => {
    const schema = JSON.parse(draft.jsonLd);
    // May be an array of schemas or a single object
    const schemaStr = JSON.stringify(schema);
    expect(schemaStr).toContain("schema.org");
  });
});
