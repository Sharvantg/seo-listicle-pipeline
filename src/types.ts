// ─── Pipeline Input ───────────────────────────────────────────────────────────

export interface PipelineInput {
  primaryKeyword: string;
  secondaryKeywords: string[];
  toolCount: number; // 5–15
  notes?: string; // optional angle/notes
}

// ─── Research Agent Outputs ───────────────────────────────────────────────────

export interface KeywordResearch {
  primaryKeyword: string;
  difficulty: number; // 0–100
  volume: number; // monthly searches
  opportunity: number; // 0–100
  intent: "informational" | "commercial" | "navigational" | "transactional";
  relatedKeywords: Array<{
    keyword: string;
    volume: number;
    difficulty: number;
  }>;
}

export interface SerpResult {
  title: string;
  url: string;
  domain: string;
  snippet: string;
  position: number;
}

export interface SerpInsights {
  topResults: SerpResult[];
  linkedDomains: string[]; // authoritative domains the top articles link to
  commonTopics: string[]; // topics appearing across multiple results
  avgWordCount?: number;
}

// What a single AI model says when asked "what are the top tools for [keyword] in the US?"
export interface AiCitationInsight {
  model: string; // e.g. 'claude-sonnet-4-6' | 'openai-gpt-4o'
  toolsMentioned: Array<{
    name: string;
    rank: number;
    reasoning: string;
    bestFor: string;
  }>;
  sourcesReferenced: Array<{
    name: string; // e.g. "G2 Crowd", "Gartner Peer Insights", "Capterra"
    relevance: string;
  }>;
  keyInsights: string[]; // important facts/stats the model cites about the category
  rawResponse: string; // full model response for debugging
}

export interface CitationSources {
  urls: string[]; // any specific URLs cited by models
  domains: string[]; // unique domains
  aiInsights: AiCitationInsight[]; // structured response from each model
  consensusTools: string[]; // tools mentioned by BOTH Claude and OpenAI (highest AEO signal)
}

// ─── Tool Data ────────────────────────────────────────────────────────────────

export interface ToolCandidate {
  name: string;
  website: string;
  confidence: number; // 0–1
  source: string;
  reason?: string;
}

export interface ToolData {
  name: string;
  website: string;
  tagline: string;
  bestFor: string;
  strengths: string[];
  gaps: string[];
  pricing: string;
  pricingUrl: string;
  g2Rating: string;
  capteraRating?: string;
  notableCustomers: string[];
  category: string;
}

// ─── Research Synthesis ───────────────────────────────────────────────────────

export interface ResearchSynthesis {
  keywordData: KeywordResearch;
  serpInsights: SerpInsights;
  citationSources: CitationSources;
  contentGaps: string[];
  linkTargets: string[];
  commonTools: string[];
}

// ─── Generated Draft ──────────────────────────────────────────────────────────

export interface GeneratedDraft {
  title: string;
  metaDescription: string;
  slug: string;
  content: string; // full markdown
  wordCount: number;
  primaryKwDensity: number;
  jsonLd: string; // JSON-LD schema block
}

// ─── Eval Agent ───────────────────────────────────────────────────────────────

export interface EvalMetricResult {
  metric: string;
  score: number; // points earned
  maxScore: number;
  passed: boolean;
  detail: string; // human-readable description of result
}

export interface EvalAttempt {
  round: number; // 0 = initial score, 1-3 = after revision
  score: number;
  failedMetrics: string[];
}

export interface EvalResult {
  overallScore: number; // 0–100
  passed: boolean; // score >= 90
  metrics: EvalMetricResult[];
  retryComments: string; // formatted feedback for Claude retry
  retryCount: number;
  flaggedForReview: boolean;
  attempts?: EvalAttempt[]; // history of scores across rounds
}

// ─── Pipeline State ───────────────────────────────────────────────────────────

export type PipelineStage =
  | "idle"
  | "researching"
  | "discovering-tools"
  | "awaiting-review"
  | "enriching"
  | "generating"
  | "evaluating"
  | "retrying"
  | "complete"
  | "error";

export interface StageStatus {
  stage: PipelineStage;
  label: string;
  status: "pending" | "in_progress" | "complete" | "error";
  detail?: string;
}

export interface PipelineState {
  input: PipelineInput;
  research?: ResearchSynthesis;
  toolCandidates?: ToolCandidate[];
  approvedTools?: ToolCandidate[];
  enrichedTools?: ToolData[];
  draft?: GeneratedDraft;
  evalResult?: EvalResult;
  currentStage: PipelineStage;
  pipelineRunId?: string; // Supabase pipeline_runs.run_id for tracing
  error?: string;
  webflowItemId?: string;
  webflowEditUrl?: string;
}

// ─── Benchmark ────────────────────────────────────────────────────────────────

export interface BenchmarkEntry {
  url: string;
  title: string;
  wordCount: number;
  h2Count: number;
  h3Count: number;
  toolCount: number;
  fleschScore: number;
  ctaCount: number;
  internalLinkCount: number;
  primaryKwDensity: number;
  hasComparisonTable: boolean;
  hasFaq: boolean;
  hasBuyingGuide: boolean;
}

export interface BenchmarkData {
  entries: BenchmarkEntry[];
  avgWordCount: number;
  avgFleschScore: number;
  avgToolCount: number;
  avgH2Count: number;
  commonStructure: string[];
  generatedAt: string;
}

// ─── Webflow ──────────────────────────────────────────────────────────────────

export interface WebflowPublishResult {
  itemId: string;
  editUrl: string;
  slug: string;
}
