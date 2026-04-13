/**
 * Webflow CMS v2 API client
 * Pushes content as draft to Zuddl's blog collection.
 */

import type { GeneratedDraft, WebflowPublishResult } from "../types";

const WEBFLOW_API = process.env.WEBFLOW_API!;
const WEBFLOW_COLLECTION_ID = process.env.WEBFLOW_COLLECTION_ID!;
const WEBFLOW_BASE = "https://api.webflow.com/v2";

interface WebflowItemResponse {
  id?: string;
  slug?: string;
  fieldData?: Record<string, unknown>;
}

export async function publishToWebflow(draft: GeneratedDraft): Promise<WebflowPublishResult> {
  const payload = {
    isArchived: false,
    isDraft: true,
    fieldData: {
      name: draft.title,
      slug: draft.slug,
      article: draft.content,
      "meta-description": draft.metaDescription,
      "schema-markup": `<script type="application/ld+json">\n${draft.jsonLd}\n</script>`,
    },
  };

  const res = await fetch(
    `${WEBFLOW_BASE}/collections/${WEBFLOW_COLLECTION_ID}/items`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WEBFLOW_API}`,
        "Content-Type": "application/json",
        "accept-version": "2.0.0",
      },
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Webflow API error ${res.status}: ${errorText}`);
  }

  const data = await res.json() as WebflowItemResponse;
  const itemId = data.id ?? "";
  const slug = data.slug ?? draft.slug;

  const editUrl = "https://sharvans-fabulous-site.design.webflow.com/?workflow=cms";

  return { itemId, editUrl, slug };
}

export async function getWebflowCollection(): Promise<Record<string, unknown>> {
  const res = await fetch(`${WEBFLOW_BASE}/collections/${WEBFLOW_COLLECTION_ID}`, {
    headers: {
      Authorization: `Bearer ${WEBFLOW_API}`,
      "accept-version": "2.0.0",
    },
  });

  if (!res.ok) {
    throw new Error(`Webflow API error ${res.status}`);
  }

  return res.json() as Promise<Record<string, unknown>>;
}
