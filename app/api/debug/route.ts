/**
 * GET /api/debug
 * Checks env var presence and tests each external API with a minimal call.
 * Returns a JSON report — use to diagnose production failures.
 */

import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const dynamic = "force-dynamic"; // never cache this endpoint

type CheckResult = { status: "ok" | "missing" | "error"; detail?: string };
type Report = Record<string, CheckResult | Record<string, string>>;

function maskKey(val: string | undefined): string {
  if (!val) return "(not set)";
  return val.slice(0, 8) + "..." + val.slice(-4) + ` [${val.length} chars]`;
}

export async function GET() {
  const report: Report = {};

  // ── Env var presence ──────────────────────────────────────────────────────
  const envVars = [
    "ANTHROPIC_KEY",
    "SERPER_API_KEY",
    "MOZ_API_KEY",
    "PARALLEL_API_KEY",
    "VERCEL_AI_GATEWAY_KEY",
    "WEBFLOW_API",
    "WEBFLOW_COLLECTION_ID",
    "ZUDDL_BASE_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ];

  report["env_vars"] = Object.fromEntries(
    envVars.map((k) => [k, maskKey(process.env[k])])
  );

  // ── Anthropic API ─────────────────────────────────────────────────────────
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY! });
    const resp = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 10,
      messages: [{ role: "user", content: 'Reply with "ok"' }],
    });
    report["anthropic"] = {
      status: "ok",
      detail: resp.content[0].type === "text" ? resp.content[0].text.slice(0, 50) : "non-text",
    };
  } catch (e) {
    report["anthropic"] = {
      status: "error",
      detail: e instanceof Error ? e.message : String(e),
    };
  }

  // ── Serper API ────────────────────────────────────────────────────────────
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": process.env.SERPER_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: "test", num: 1 }),
    });
    const body = await res.json() as { organic?: unknown[] };
    report["serper"] = res.ok
      ? { status: "ok", detail: `HTTP ${res.status}, organic results: ${body.organic?.length ?? 0}` }
      : { status: "error", detail: `HTTP ${res.status}` };
  } catch (e) {
    report["serper"] = { status: "error", detail: e instanceof Error ? e.message : String(e) };
  }

  // ── MOZ API (v2 REST — same endpoint as keyword service) ─────────────────
  try {
    const res = await fetch("https://lsapi.seomoz.com/v2/keyword_data", {
      method: "POST",
      headers: {
        Authorization: `Basic ${process.env.MOZ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ keywords: ["test"], metrics: ["difficulty", "volume"] }),
    });
    const text = await res.text();
    report["moz"] = res.ok
      ? { status: "ok", detail: `HTTP ${res.status}: ${text.slice(0, 100)}` }
      : { status: "error", detail: `HTTP ${res.status}: ${text.slice(0, 200)}` };
  } catch (e) {
    report["moz"] = { status: "error", detail: e instanceof Error ? e.message : String(e) };
  }

  // ── Vercel AI Gateway (OpenAI) ────────────────────────────────────────────
  try {
    const res = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.VERCEL_AI_GATEWAY_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini",
        messages: [{ role: "user", content: 'Reply "ok"' }],
        max_tokens: 16,
      }),
    });
    const body = await res.text();
    report["vercel_ai_gateway"] = res.ok
      ? { status: "ok", detail: `HTTP ${res.status}` }
      : { status: "error", detail: `HTTP ${res.status}: ${body.slice(0, 200)}` };
  } catch (e) {
    report["vercel_ai_gateway"] = { status: "error", detail: e instanceof Error ? e.message : String(e) };
  }

  // ── Supabase ──────────────────────────────────────────────────────────────
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (supabaseUrl) {
    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/pipeline_runs?select=run_id&limit=1`, {
        headers: {
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
        },
      });
      report["supabase"] = res.ok
        ? { status: "ok", detail: `HTTP ${res.status}` }
        : { status: "error", detail: `HTTP ${res.status}` };
    } catch (e) {
      report["supabase"] = { status: "error", detail: e instanceof Error ? e.message : String(e) };
    }
  } else {
    report["supabase"] = { status: "missing", detail: "NEXT_PUBLIC_SUPABASE_URL not set" };
  }

  return NextResponse.json(report, { status: 200 });
}
