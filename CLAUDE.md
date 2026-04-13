# SEO Listicle Pipeline — CLAUDE.md

> This file is the authoritative reference for the system's architecture, current state, known gaps,
> and design decisions. Update it whenever the architecture changes meaningfully.
>
> **If you are an AI agent:** read this file before touching any code. It will save you from making
> incorrect assumptions about the route structure, API integrations, and code conventions.

---

## What We're Building

An automated pipeline for Zuddl that produces publication-ready SEO listicles (e.g. "Best Event
Registration Software 2026") at scale. The pipeline:

1. Takes a keyword as input
2. Runs multi-source research (keyword data, SERP, AI search citations / AEO)
3. Discovers competing tools in the category
4. Human checkpoint: approve/remove/reorder tools
5. Deep per-tool research via Parallel.ai (async, 10–20 min)
6. Generates a structured article with Claude (two-pass: draft + humanization)
7. Evaluates and auto-revises the article (up to 3 rounds, server-side SSE loop)
8. Pushes a passing draft to Webflow CMS for final human review before publish

**Core constraint:** Zuddl is always the featured/recommended tool in the article. All prompts,
link targets, and eval metrics are tuned specifically for Zuddl's positioning.

---

## Code Conventions: Agents vs Services

**`src/agents/`** — files that call an LLM to reason, extract, or generate:
- `citation-agent.ts` — queries Claude + GPT-4o, parses structured AEO intelligence
- `tool-discovery-agent.ts` — feeds Serper results to Claude for tool extraction
- `generation-agent.ts` — two-pass Claude article generation + humanization
- `eval-agent.ts` — 100-point scoring (deterministic metrics + Claude tone check)
- `revision-agent.ts` — single Claude revision call (round-aware strategy selection)

**`src/services/`** — deterministic wrappers around external APIs (no LLM):
- `keyword.ts` — MOZ API → `KeywordResearch`
- `serp.ts` — Serper API → `SerpInsights`
- `enrichment.ts` — Parallel.ai task group submit + status polling + result parsing

Do not blur this boundary. If a file calls Claude/OpenAI, it belongs in `agents/`.

---

## Architecture: Current State

### Research Phase — `POST /api/pipeline`

Runs three parallel operations and creates a `pipeline_runs` row with `status='awaiting_tool_review'`.

#### Keyword Service — `src/services/keyword.ts`
- Calls MOZ `/v2/keyword_data` + `/v2/keyword_suggestions`
- Auth: `Authorization: Basic {MOZ_API_KEY}` where `MOZ_API_KEY` is Base64-encoded `"accessId:secretKey"`
- Falls back to `estimateDifficulty()` / `estimateVolume()` heuristics if MOZ fails (returns sensible
  B2B SaaS estimates rather than 0/0)
- **Gap:** MOZ API is intermittently failing — logs now include response body to diagnose. Intent
  detection is a regex heuristic, not from MOZ data.

#### SERP Service — `src/services/serp.ts`
- Fetches top-10 results from Serper API (`gl: "us"`)
- `linkedDomains` = the ranking pages' own domains (NOT outbound links those pages cite)
- `commonTopics` = words appearing in ≥2 result titles/snippets
- **Gap:** We don't scrape the actual pages to find real outbound links. Authority domains (G2,
  Gartner, etc.) come from the citation agent's `sourcesReferenced`, not SERP.

#### Citation Agent — `src/agents/citation-agent.ts` (AEO)
- **Purpose:** Answer Engine Optimization. Ask Claude and GPT-4o "What are the top 10 [keyword]
  in the US?" — parse which tools they recommend, what sources they cite, what facts they state.
  Use this to write articles aligned with what AI models already know, so Zuddl gets cited.
- Queries Claude (Anthropic SDK) + OpenAI GPT-4o via **Vercel AI Gateway** (`https://ai-gateway.vercel.sh/v1`)
- Both run in parallel via `Promise.allSettled` (one failing doesn't block the other)
- Returns `consensusTools` = tools both models recommend (highest AEO signal)
- **NOT web search** — we're reading model training knowledge, which drives AI answer citations
- Env var: `VERCEL_AI_GATEWAY_KEY` (requires Vercel account with billing enabled)

### Tool Discovery — inside `POST /api/pipeline`

Uses `src/agents/tool-discovery-agent.ts`:
1. Runs 3 Serper searches in parallel: "best [keyword] software 2025", "top [keyword] platforms
   comparison reviews", "[keyword] tools site:g2.com OR site:capterra.com OR site:getapp.com"
2. Passes all text to Claude to extract, deduplicate, and rank tools with websites
3. Claude ensures Zuddl is always present; no other hardcoded tools
4. If Serper fails: Claude uses training knowledge. If Claude fails: returns empty array.

Returns `toolCandidates` to the frontend for the human review step.

### Tool Enrichment — `POST /api/pipeline/[runId]/approve`

On tool approval, calls `src/services/enrichment.ts`:
1. Creates a Parallel.ai task group (`POST /v1beta/tasks/groups`)
2. Adds one run per approved tool (`POST /v1beta/tasks/groups/{id}/runs`)
   - Auth: `x-api-key` header (NOT `Authorization: Bearer`)
   - Each run input: `{ tool_name, tool_website, keyword }`
   - `default_task_spec` includes full JSON `input_schema` and `output_schema`
   - Response field: `taskgroup_id` (NOT `task_group_id`), `run_ids` (NOT `runs[].run_id`)
3. Stores `parallel_group_id` + `parallel_run_ids` in `enrichment_jobs` row
4. Transitions `pipeline_runs.status` → `enriching`

**No webhooks.** Completion is detected lazily: every `GET /api/pipeline/[runId]` call checks
Parallel's group status when `status='enriching'`. When all runs complete, it fetches per-run
results, stores them in `enrichment_jobs.results`, and flips to `ready_to_generate`.

- **Gap:** If Parallel runs fail silently, the pipeline stays in `enriching` forever. No timeout
  or escape hatch — user must manually update the DB row status to `error`.

### Article Generation + Eval Loop — `POST /api/pipeline/[runId]/run` (SSE)

This endpoint is a **Server-Sent Events stream**. The frontend opens it after seeing
`status='ready_to_generate'`. The entire generation + eval loop runs server-side:

```
src/pipeline/runner.ts — runPipelinePhase()
  ↓ runGenerationAgent()   → 2-pass Claude article (src/agents/generation-agent.ts)
  ↓ runEvalAgent()         → 100-point score (src/agents/eval-agent.ts)
  ↓ [if score < 75]
    runRevisionAgent()     → one Claude revision (src/agents/revision-agent.ts)
    runEvalAgent()         → re-score
    [repeat up to 3 rounds, escalating strategy]
  ↓ completePipelineRun()  → saves final draft + eval to pipeline_runs
```

SSE event types emitted to the frontend:
```typescript
| { type: 'generating'; detail: string }
| { type: 'generating_done'; wordCount: number }
| { type: 'evaluating'; round: number }
| { type: 'eval_done'; round: number; score: number; passed: boolean }
| { type: 'revising'; round: number }
| { type: 'complete'; draft: GeneratedDraft; evalResult: EvalResult }
| { type: 'error'; message: string }
```

### Eval Metrics (100 pts total, pass threshold: 75)

| Metric | Points | Rule |
|---|---|---|
| Word count | 15 | ±15% of benchmark avg (2800 words placeholder) |
| Primary KW density | 15 | 1–2% of total words |
| Secondary KWs | 10 | Each appears ≥1x |
| Flesch reading ease | 20 | ≥50 |
| Structure completeness | 15 | Comparison table + FAQ + buying guide present |
| Internal Zuddl links | 10 | ≥3 links to zuddl.com |
| AI-isms | 10 | <3 flagged phrases |
| Tone authenticity | 5 | Claude judge (pass/fail) |

3 escalating revision strategies (round 0: targeted, round 1: surgical with exact numbers,
round 2: hard constraints). After round 3 fails: `flaggedForReview = true`, Webflow push blocked.

### Webflow Publishing — `POST /api/pipeline/[runId]/publish`

Uses `src/integrations/webflow.ts`. Pushes to Webflow CMS v2 as a draft (not published).
Webflow collection fields: `name`, `slug`, `article` (post body), `meta-description`, `schema-markup`.
Edit URL: `https://sharvans-fabulous-site.design.webflow.com/?workflow=cms`
Blocked if `evalResult.flaggedForReview === true`.

---

## Data Flow

```
User Input (keyword, secondary KWs, tool count, notes)
  ↓
POST /api/pipeline
  ↓  Parallel: keyword service + SERP service + citation agent + tool discovery agent
  ↓  Creates pipeline_runs row (status: awaiting_tool_review)
  ↓  Stores: research, tool_candidates columns
/review               ← Human approves/removes/reorders tools
  ↓
POST /api/pipeline/[runId]/approve
  ↓  Submits to Parallel.ai (groupId + runIds stored in enrichment_jobs)
  ↓  pipeline_runs.status → enriching
/generating           ← Polls GET /api/pipeline/[runId] every 30s
  ↓  (GET endpoint lazily checks Parallel status and flips to ready_to_generate)
POST /api/pipeline/[runId]/run   ← SSE stream opened by frontend
  ↓  src/pipeline/runner.ts drives the full generation + eval loop
  ↓  Events: generating → generating_done → evaluating → eval_done → [revising...] → complete
  ↓  pipeline_runs.status → complete, final_draft + eval fields written
/output               ← GET /api/pipeline/[runId] returns full run data + enrichedTools
POST /api/pipeline/[runId]/publish  ← Webflow CMS draft push
```

### State Persistence

`runId` is stored in **localStorage** (survives browser close). On each page mount:
1. Read `localStorage.getItem('pipelineRunId')`
2. Fetch `GET /api/pipeline/[runId]`
3. Route to correct page based on `run.status`

Status → page routing:
- `awaiting_tool_review` → `/review`
- `enriching` / `ready_to_generate` → `/generating` (polls for ready_to_generate)
- `generating` / `evaluating` / `revising` → `/generating` (re-opens SSE stream)
- `complete` → `/output`

---

## Environment Variables

```
ANTHROPIC_KEY              # Anthropic SDK — generation, eval tone, humanization
SERPER_API_KEY             # Serper API — SERP results + tool discovery searches
MOZ_API_KEY                # Base64-encoded "accessId:secretKey" — keyword metrics
PARALLEL_API_KEY           # Parallel.ai — async batch tool enrichment (x-api-key auth)
VERCEL_AI_GATEWAY_KEY      # Vercel AI Gateway — GPT-4o calls in citation agent
WEBFLOW_API                # Webflow CMS v2 API token
WEBFLOW_COLLECTION_ID      # Webflow blog collection ID
ZUDDL_BASE_URL             # https://www.zuddl.com (used in prompts + eval link counting)
NEXT_PUBLIC_SUPABASE_URL   # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY  # Supabase anon key (RLS enforced)
SUPABASE_WEBHOOK_URL       # Supabase Edge Function URL (parallel-webhook, unused currently)
```

---

## Known Gaps — Priority Order

### P1 — Important for quality / reliability

1. **MOZ API intermittently failing**
   - Logs now include response body — check server logs to see exact HTTP error
   - Fallback estimates are shown when MOZ fails (38/800 for long-tail B2B terms)
   - Likely cause: quota exhaustion or subscription tier doesn't include Keyword Explorer

2. **Parallel.ai enrichment — no timeout/escape hatch**
   - If Parallel runs fail, `pipeline_runs.status` stays `enriching` forever
   - User must manually update DB: `UPDATE pipeline_runs SET status='error' WHERE run_id='...'`
   - Fix: Add max polling age (e.g. 30 min) with automatic transition to `error`

3. **SERP linked domains are ranking page domains, not true outbound links**
   - True fix: scrape each top-5 SERP page and extract `<a href>` domains
   - Workaround: citation agent's `sourcesReferenced` provides the authority domains

4. **Benchmark data is a placeholder**
   - `avgWordCount: 2800` — run `npm run benchmark` to calibrate from real Zuddl articles
   - Eval word count target and generation prompt guidelines depend on this

### P2 — Nice to have

5. **Flesch score uses vowel-group syllable heuristic** — close enough for comparisons
6. **No research result caching** — every run re-fetches MOZ/Serper for the same keyword

---

## Key Design Decisions

| Decision | Rationale |
|---|---|
| Server-side SSE eval loop (not frontend) | Survives browser refresh; frontend is a thin progress display |
| Parallel.ai polling (not webhooks) | Parallel.ai task group API doesn't support webhooks; lazy check on GET avoids a separate polling route |
| Services vs Agents taxonomy | Makes it immediately clear which files contain LLM calls (agents/) vs deterministic I/O (services/) |
| localStorage for runId | Survives browser close; user can return after 20 min to find article complete |
| 75/100 pass threshold | Calibrated to real Claude output quality — Flesch ≥50 and tone are hard to fully automate |
| 3 escalating revision strategies | Each round uses a different approach (targeted → surgical → hard constraints) |
| `flaggedForReview` blocks Webflow push | Manual review required if automation fails — no silent bad articles |
| Benchmark as a one-time script | Avoids expensive MOZ + Claude analysis on every run |
| `pipeline_runs` + `eval_traces` in Supabase | Full auditability — can replay exactly what happened for any run |

---

## Supabase Schema

```
enrichment_jobs
  run_id (text PK)
  parallel_group_id (text)        — Parallel.ai taskgroup_id
  parallel_run_ids (jsonb)        — string[] of individual Parallel run IDs (ordered = tools ordered)
  keyword (text)
  tool_count (integer)
  tool_names (text[])
  status (pending|processing|completed|failed)
  results (jsonb)                 — Array<{ toolName, output, error }> from Parallel
  error (text)
  created_at, updated_at

pipeline_runs
  run_id (text unique)
  keyword (text)
  input (jsonb)                   — PipelineInput (primary KW, secondary KWs, tool count, notes)
  approved_tools (jsonb)          — ToolCandidate[] after human review
  research (jsonb)                — ResearchSynthesis (stored for resume)
  tool_candidates (jsonb)         — ToolCandidate[] before review (stored for resume)
  enrichment_run_id (text)        — FK to enrichment_jobs.run_id
  status (text)                   — researching|awaiting_tool_review|enriching|ready_to_generate|
                                    generating|evaluating|revising|complete|error
  current_revision_round (integer)
  final_draft (jsonb)             — GeneratedDraft
  eval_score, eval_passed, eval_flagged, eval_retry_count
  eval_metrics (jsonb)
  eval_attempts (jsonb)
  error (text)
  webflow_item_id, webflow_edit_url
  created_at, completed_at

eval_traces
  id (uuid PK)
  run_id (text FK → pipeline_runs)
  round (integer)
  stage (score|revise)
  eval_score, eval_passed
  eval_metrics (jsonb), failed_metrics (text[])
  draft_word_count (integer)
  draft_content (text)
  revision_strategy (text)
  revision_prompt (text)
  created_at
```

---

## File Map

```
app/
  page.tsx                        — Step 1: keyword input form (InputForm component)
  review/page.tsx                 — Step 4: tool approval checkpoint (ToolReview component)
  generating/page.tsx             — Steps 5–7: SSE stream subscriber + progress display
  output/page.tsx                 — Step 8: results (reads runId from localStorage)
  output/[runId]/page.tsx         — Direct URL access to any completed run
  api/pipeline/
    route.ts                      — POST: research phase + tool discovery; returns runId + toolCandidates
    [runId]/route.ts              — GET: returns full pipeline run (lazily checks Parallel when enriching)
    [runId]/approve/route.ts      — POST: submits enrichment, transitions to enriching
    [runId]/run/route.ts          — POST: SSE stream — generation + eval loop
    [runId]/publish/route.ts      — POST: pushes to Webflow CMS

src/
  types.ts                        — All shared TypeScript interfaces
  agents/                         — LLM-based reasoning (all Claude/OpenAI calls live here)
    citation-agent.ts             — AEO: Claude + GPT-4o via Vercel AI Gateway [✅]
    tool-discovery-agent.ts       — Serper searches → Claude extraction [✅]
    generation-agent.ts           — 2-pass Claude article generation + humanization [✅]
    eval-agent.ts                 — 100-point scoring (deterministic + Claude tone) [✅]
    revision-agent.ts             — Single Claude revision (round-aware strategy) [✅]
  services/                       — Deterministic external API wrappers (no LLM)
    keyword.ts                    — MOZ API → KeywordResearch [✅, fallback if MOZ fails]
    serp.ts                       — Serper API → SerpInsights [✅]
    enrichment.ts                 — Parallel.ai submit + poll + parse [✅]
  pipeline/
    runner.ts                     — runPipelinePhase(): generation + eval loop orchestrator
  prompts/
    system-prompt.ts              — Builds Claude system prompt from benchmark guidelines
    section-prompts.ts            — Per-section prompt builders
    eval-prompts.ts               — 3 escalating revision prompts (round 0/1/2)
  integrations/
    webflow.ts                    — Webflow CMS v2 client
    semantic-markup.ts            — JSON-LD schema generator (Article, ItemList, FAQPage)
  benchmark/
    run-benchmark.ts              — One-time benchmark extraction script (npm run benchmark)
    benchmark.json                — [PLACEHOLDER — run npm run benchmark against real Zuddl pages]
    system-prompt-guidelines.md   — Writing style rules derived from benchmark

lib/
  supabase.ts                     — Supabase client + all table types (EnrichmentJob, PipelineRun, EvalTrace)
  pipeline-store.ts               — Server-side DB helpers (create/complete/error runs, save traces)
  logger.ts                       — Structured logging (log.info / log.warn / log.error)
  utils.ts                        — cn() Tailwind class helper

components/
  InputForm.tsx                   — KW input form; calls POST /api/pipeline, stores runId in localStorage
  ToolReview.tsx                  — Tool approve/remove/reorder; calls POST /api/pipeline/[runId]/approve
  ProgressTracker.tsx             — Stage progress display; subscribes to SSE stream
  EvalScorecard.tsx               — Per-metric eval breakdown card
  OutputPreview.tsx               — Article preview + Webflow publish button
  RunOutput.tsx                   — Tabbed output: Research | Tool Intelligence | Article

tests/
  fixtures.ts                     — Shared test fixtures (mock ResearchSynthesis, ToolData, etc.)
  agents/                         — Unit tests for each agent
  services/                       — Unit tests for keyword + SERP services
  e2e/                            — End-to-end pipeline tests (require live API keys)
```

---

## Benchmark Script

Run once to populate `src/benchmark/benchmark.json` and `src/benchmark/system-prompt-guidelines.md`:

```bash
npm run benchmark
```

Fetches Zuddl's top-ranking listicles, scrapes their content, uses Claude to extract writing
patterns (avg word count, structure, tone, keyword density). The eval word-count threshold and
generation system prompt are based on this data. **Currently using placeholder values (2800 words avg).**
