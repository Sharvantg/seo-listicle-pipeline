/**
 * JSON-LD Schema Generator
 * Generates Article, ItemList, and FAQPage schemas.
 */

import type { ToolData } from "../types";

interface SchemaInput {
  title: string;
  slug: string;
  tools: ToolData[];
  content: string;
  primaryKeyword: string;
}

export function generateSchemas(input: SchemaInput): string {
  const schemas = [
    buildArticleSchema(input),
    buildItemListSchema(input),
    buildFaqSchema(input.content),
  ].filter(Boolean);

  return JSON.stringify(schemas, null, 2);
}

function buildArticleSchema(input: SchemaInput): object {
  const baseUrl = process.env.ZUDDL_BASE_URL ?? "https://www.zuddl.com";

  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: input.title,
    description: `A comprehensive comparison of the best ${input.primaryKeyword} to help you choose the right platform.`,
    author: {
      "@type": "Organization",
      name: "Zuddl",
      url: baseUrl,
    },
    publisher: {
      "@type": "Organization",
      name: "Zuddl",
      url: baseUrl,
      logo: {
        "@type": "ImageObject",
        url: `${baseUrl}/images/zuddl-logo.png`,
      },
    },
    datePublished: new Date().toISOString().split("T")[0],
    dateModified: new Date().toISOString().split("T")[0],
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": `${baseUrl}/blog/${input.slug}`,
    },
  };
}

function buildItemListSchema(input: SchemaInput): object {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: input.title,
    description: `List of the best ${input.primaryKeyword}`,
    numberOfItems: input.tools.length,
    itemListElement: input.tools.map((tool, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: tool.name,
      url: tool.website,
      description: tool.tagline,
    })),
  };
}

function buildFaqSchema(content: string): object | null {
  const faqs = extractFaqs(content);
  if (faqs.length === 0) return null;

  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: {
        "@type": "Answer",
        text: answer,
      },
    })),
  };
}

function extractFaqs(content: string): Array<{ question: string; answer: string }> {
  const faqs: Array<{ question: string; answer: string }> = [];

  // Find FAQ section
  const faqMatch = content.match(/##\s*(?:FAQ|Frequently Asked Questions)[\s\S]*?(?=\n##\s|\n---|\Z)/i);
  if (!faqMatch) return faqs;

  const faqSection = faqMatch[0];

  // Extract Q&A pairs (H3 = question, following text = answer)
  const questionPattern = /###\s+(.+?)\n([\s\S]*?)(?=###|\z)/g;
  let match;

  while ((match = questionPattern.exec(faqSection)) !== null) {
    const question = match[1].trim();
    const answer = match[2]
      .trim()
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // strip links
      .replace(/[*_]/g, "") // strip formatting
      .slice(0, 300);

    if (question && answer) {
      faqs.push({ question, answer });
    }
  }

  return faqs.slice(0, 6); // FAQPage schema: max 6 recommended
}
