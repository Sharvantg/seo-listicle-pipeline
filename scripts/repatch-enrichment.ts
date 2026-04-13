/**
 * One-off script: re-fetches Parallel.ai results for a completed enrichment_jobs row
 * and patches the results column with correctly parsed data.
 *
 * Usage:
 *   npx tsx scripts/repatch-enrichment.ts <enrichment_run_id>
 *
 * The enrichment_run_id is the same as the pipeline run_id for this project.
 */

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";

// Load .env.local
const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

const PARALLEL_API_KEY = process.env.PARALLEL_API_KEY!;
const PARALLEL_BASE = "https://api.parallel.ai";
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function main() {
  const enrichmentRunId = process.argv[2] ?? "fc5af500-9589-4f54-aa80-e2a339d69a1f";

  console.log(`Re-patching enrichment_jobs row: ${enrichmentRunId}`);

  const { data: job, error } = await supabase
    .from("enrichment_jobs")
    .select("*")
    .eq("run_id", enrichmentRunId)
    .single();

  if (error || !job) {
    console.error("Failed to load enrichment_jobs row:", error?.message ?? "not found");
    process.exit(1);
  }

  const runIds: string[] = (job.parallel_run_ids as string[]) ?? [];
  const toolNames: string[] = (job.tool_names as string[]) ?? [];

  if (runIds.length === 0) {
    console.error("No parallel_run_ids found");
    process.exit(1);
  }

  console.log(`Fetching ${runIds.length} results from Parallel...`);

  const results = await Promise.all(
    runIds.map(async (parallelRunId, i) => {
      const toolName = toolNames[i] ?? null;
      try {
        const res = await fetch(`${PARALLEL_BASE}/v1/tasks/runs/${parallelRunId}/result`, {
          headers: { "x-api-key": PARALLEL_API_KEY },
          cache: "no-store" as RequestCache,
        });

        if (!res.ok) {
          const text = await res.text();
          console.warn(`  [${toolName}] HTTP ${res.status}: ${text.slice(0, 100)}`);
          return { toolName, output: null, error: `HTTP ${res.status}` };
        }

        const data = await res.json() as { output?: { content?: unknown; value?: unknown } };

        // Parallel returns content as string OR object when output_schema is used
        const rawContent = data.output?.content ?? data.output?.value ?? null;
        const output =
          rawContent === null || rawContent === undefined
            ? null
            : typeof rawContent === "string"
            ? rawContent
            : JSON.stringify(rawContent);

        const preview = output?.slice(0, 80) ?? "(null)";
        console.log(`  [${toolName}] OK — ${preview}...`);

        return { toolName, output, error: null };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`  [${toolName}] Exception: ${msg}`);
        return { toolName, output: null, error: msg };
      }
    })
  );

  const successCount = results.filter((r) => r.output !== null).length;
  console.log(`\nFetched ${successCount}/${results.length} results successfully.`);

  const { error: updateError } = await supabase
    .from("enrichment_jobs")
    .update({ results, status: "completed", updated_at: new Date().toISOString() })
    .eq("run_id", enrichmentRunId);

  if (updateError) {
    console.error("Failed to update enrichment_jobs:", updateError.message);
    process.exit(1);
  }

  console.log("✓ enrichment_jobs.results patched successfully.");
  console.log(`Now visit /output/${enrichmentRunId} to see the Tool Intelligence tab.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
