# SEO Listicle Pipeline

Automated pipeline that produces publication-ready SEO listicles for Zuddl — from a single keyword to a Webflow-published draft, with AI-powered research, tool enrichment, generation, and eval.

---

> **AI agents / LLMs reading this codebase:** start with [CLAUDE.md](./CLAUDE.md). It contains the full architecture, data flow diagrams, design decisions, known gaps, and a complete file map. This README covers setup only.

---

## What it does

1. Takes a primary keyword (e.g. "best virtual event software 2026")
2. Runs parallel research — keyword metrics (MOZ), SERP top results (Serper), and AEO intelligence (what Claude + GPT-4 already recommend for this query)
3. Discovers competing tools via Serper + Claude extraction
4. Human checkpoint: approve/remove/reorder tools before enrichment
5. Deep per-tool research via Parallel.ai (async, 10–20 min)
6. Generates a structured listicle article with Claude (two-pass: draft + humanization)
7. Auto-evaluates on 8 metrics (100-point scale) and self-revises up to 3 rounds
8. Pushes passing drafts to Webflow CMS as a draft for final human review

Zuddl is always the featured/recommended tool. All prompts, eval metrics, and link targets are tuned for Zuddl's positioning.

---

## Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router), TypeScript |
| UI | shadcn/ui, Tailwind CSS |
| LLM | Anthropic Claude (sonnet-4-6) |
| Keyword data | MOZ Keyword Explorer API |
| SERP | Serper API |
| AEO research | Claude + OpenAI GPT-4o via Vercel AI Gateway |
| Tool enrichment | Parallel.ai (async task groups) |
| Database | Supabase (PostgreSQL) |
| Publishing | Webflow CMS v2 API |

---

## Prerequisites

- Node.js 18+
- A Supabase project with the schema below
- API keys for: Anthropic, Serper, MOZ, Parallel.ai, Vercel AI Gateway, Webflow

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env.local
```

Fill in `.env.local` with your API keys. See `.env.example` for all required variables.

### 3. Supabase schema

Run these in your Supabase SQL editor:

```sql
-- Tracks Parallel.ai enrichment jobs
create table enrichment_jobs (
  run_id text primary key,
  parallel_group_id text,
  parallel_run_ids jsonb,
  keyword text,
  tool_count integer,
  tool_names text[],
  status text check (status in ('pending','processing','completed','failed')),
  results jsonb,
  error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- One row per article generation attempt
create table pipeline_runs (
  run_id text unique not null,
  keyword text,
  input jsonb,
  approved_tools jsonb,
  research jsonb,
  tool_candidates jsonb,
  enrichment_run_id text,
  status text check (status in (
    'researching','awaiting_tool_review','enriching',
    'ready_to_generate','generating','evaluating','revising',
    'complete','error'
  )),
  current_revision_round integer default 0,
  final_draft jsonb,
  eval_score integer,
  eval_passed boolean,
  eval_flagged boolean,
  eval_retry_count integer,
  eval_metrics jsonb,
  eval_attempts jsonb,
  error text,
  webflow_item_id text,
  webflow_edit_url text,
  created_at timestamptz default now(),
  completed_at timestamptz
);

-- One row per eval/revise event — full audit trail
create table eval_traces (
  id uuid primary key default gen_random_uuid(),
  run_id text references pipeline_runs(run_id),
  round integer,
  stage text check (stage in ('score','revise')),
  eval_score integer,
  eval_passed boolean,
  eval_metrics jsonb,
  failed_metrics text[],
  draft_word_count integer,
  draft_content text,
  revision_strategy text,
  revision_prompt text,
  created_at timestamptz default now()
);
```

Enable RLS and add anon policies:

```sql
alter table enrichment_jobs enable row level security;
alter table pipeline_runs enable row level security;
alter table eval_traces enable row level security;

-- pipeline_runs
create policy "anon select" on pipeline_runs for select using (true);
create policy "anon insert" on pipeline_runs for insert with check (true);
create policy "anon update" on pipeline_runs for update using (true);

-- enrichment_jobs
create policy "anon select" on enrichment_jobs for select using (true);
create policy "anon insert" on enrichment_jobs for insert with check (true);
create policy "anon update" on enrichment_jobs for update using (true);

-- eval_traces
create policy "anon select" on eval_traces for select using (true);
create policy "anon insert" on eval_traces for insert with check (true);
```

### 4. Supabase Edge Function

Deploy the `parallel-webhook` Edge Function to receive Parallel.ai completion webhooks:

```bash
supabase functions deploy parallel-webhook --no-verify-jwt
```

### 5. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Benchmark (optional)

The eval word-count target is based on a benchmark of Zuddl's top-ranking listicles. Run once to populate `src/benchmark/benchmark.json`:

```bash
npm run benchmark
```

The repo ships with placeholder benchmark values (2800 words avg). Run this against real Zuddl articles to calibrate.

---

## Project structure

```
app/                     Next.js pages + API routes
  page.tsx               Step 1 — keyword input form
  review/page.tsx        Step 4 — human tool approval checkpoint
  generating/page.tsx    Steps 5–7 — progress display (SSE stream)
  output/page.tsx        Step 8 — results, eval scorecard, Webflow publish
  output/[runId]/        Direct link to any completed run
  api/pipeline/          All pipeline API routes

src/
  agents/                LLM-based reasoning (Claude calls)
  services/              Deterministic external API wrappers (MOZ, Serper, Parallel)
  pipeline/runner.ts     Core pipeline orchestrator — generation + eval loop
  prompts/               System prompt builders, section prompts, eval revision prompts
  integrations/          Webflow CMS client, JSON-LD schema generator
  benchmark/             One-time benchmark extraction script

lib/
  supabase.ts            Supabase client + all table types
  pipeline-store.ts      Server-side DB helpers
  logger.ts              Structured logging

components/              React UI components
tests/                   Jest unit + E2E tests
```

See [CLAUDE.md](./CLAUDE.md) for the full architecture, data flow, and design decisions.

---

## Running tests

```bash
npm test               # all tests
npm run test:unit      # agents + services only
npm run test:e2e       # end-to-end pipeline test (requires live API keys)
```
