import { writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { mkdirSync } from "fs";
import { providersFromEnv } from "@ai-review/llm";
import { runReview } from "@ai-review/orchestrator";
import { evaluateCase } from "./metrics.js";
import { issueToCandidate } from "./convert.js";
import { loadDataset, SYNTHETIC_V2_PATH } from "./dataset.js";
import { aggregateCounts, formatAggregate, pct } from "./summary.js";
import type { BenchmarkCase } from "./types.js";

export interface LiveArgs {
  output?: string;
  dataset?: string;
}

export function parseArgs(argv: readonly string[]): LiveArgs {
  const out: LiveArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--output" || a === "--dataset") {
      const v = argv[++i];
      if (!v) throw new Error(`${a} requires a path`);
      if (a === "--output") out.output = v;
      else out.dataset = v;
    } else if (a?.startsWith("--output=")) out.output = a.slice(9);
    else if (a?.startsWith("--dataset=")) out.dataset = a.slice(10);
  }
  return out;
}

function envRecord(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  return env;
}

/** Masks secret-looking values so error text can never leak a key. */
export function makeRedactor(env: Record<string, string>): (s: string) => string {
  const secrets = new Set<string>();
  for (const [k, v] of Object.entries(env)) {
    if (/KEY|TOKEN|SECRET|PASSWORD/i.test(k) && v.length >= 8) secrets.add(v);
  }
  try {
    const list = JSON.parse(env["AI_PROVIDERS_JSON"] ?? "[]");
    for (const p of Array.isArray(list) ? list : []) {
      if (typeof p?.apiKey === "string" && p.apiKey.length >= 8) secrets.add(p.apiKey);
    }
  } catch {
    /* ignore malformed provider JSON */
  }
  return (s) => {
    let r = s;
    for (const secret of secrets) r = r.split(secret).join("[REDACTED]");
    return r.replace(/\b(?:sk|pk|key)-[A-Za-z0-9_-]{16,}/g, "[REDACTED]");
  };
}

export async function runLiveEvaluation(args: LiveArgs = {}): Promise<void> {
  const env = envRecord();
  const providers = providersFromEnv(env);
  if (providers.length === 0) {
    console.log(
      "eval:live: no LLM provider is configured (set AI_REVIEW_LLM_PROVIDER with its API key, " +
        "or AI_PROVIDERS_JSON). Nothing was run. Use `npm run eval:rules` for the offline check.",
    );
    return;
  }
  const redact = makeRedactor(env);
  const datasetPath = args.dataset ? resolve(args.dataset) : SYNTHETIC_V2_PATH;
  const cases = loadDataset(datasetPath);
  console.log(`\nLive evaluation — ${cases.length} cases from ${datasetPath}`);
  console.log(`Providers (priority order): ${providers.map((p) => p.id).join(", ")}\n`);

  const rows: Array<Record<string, unknown>> = [];
  const reports = [];
  let totalTokens = 0;
  let totalCost = 0;

  for (const c of cases as BenchmarkCase[]) {
    let result;
    try {
      result = await runReview({
        diff: c.diff,
        files: c.inputFiles.map((f) => ({ path: f.path, text: f.content })),
        reviewId: `eval.${c.id}`,
        env,
      });
    } catch (err) {
      const message = redact(err instanceof Error ? err.message : String(err));
      console.log(`[${c.id}] ERROR: ${message}`);
      rows.push({ caseId: c.id, error: message });
      continue;
    }

    const delivered = result.issues
      .filter((i) => i.accepted)
      .map((i, n) => issueToCandidate(i, n, true));
    const rejected = result.issues
      .filter((i) => !i.accepted)
      .map((i, n) => issueToCandidate(i, n, false));
    const report = evaluateCase(delivered, rejected, c.expectedFindings, c.antiFindings, c.id);
    reports.push(report);

    const tokens = result.metrics.totalPromptTokens + result.metrics.totalCompletionTokens;
    const cost = result.metrics.totalCostUsd;
    totalTokens += tokens;
    totalCost += cost;
    const k = report.counts;
    console.log(
      `[${c.id}] delivered=${delivered.length} TP=${k.tp} FP=${k.fp} FN=${k.fn} ` +
        `precision=${pct(k.totalDelivered ? k.tp / k.totalDelivered : "N/A")} ` +
        `recall=${pct(k.totalExpected ? k.tp / k.totalExpected : "N/A")} ` +
        `tokens=${tokens} cost=$${cost.toFixed(4)}`,
    );
    for (const f of delivered) {
      console.log(`    - ${f.severity} ${f.category} ${f.location.file}:${f.location.line ?? "?"} ${redact(f.title)}`);
    }
    for (const e of result.errors) {
      console.log(`    ! ${e.agentId}: ${redact(e.message)}`);
    }
    rows.push({
      caseId: c.id,
      findings: delivered.map((f) => ({
        title: redact(f.title),
        category: f.category,
        severity: f.severity,
        file: f.location.file,
        line: f.location.line,
        endLine: f.location.endLine,
        producedBy: f.producedBy,
      })),
      counts: report.counts,
      promptTokens: result.metrics.totalPromptTokens,
      completionTokens: result.metrics.totalCompletionTokens,
      costUsd: cost,
      errors: result.errors.map((e) => ({ agentId: e.agentId, message: redact(e.message) })),
    });
  }

  const aggregate = aggregateCounts(reports);
  console.log("");
  console.log(formatAggregate("ALL cases", aggregate));
  console.log(`Total tokens=${totalTokens} cost=$${totalCost.toFixed(4)}\n`);

  if (args.output) {
    const outPath = resolve(args.output);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(
      outPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          dataset: datasetPath,
          providers: providers.map((p) => p.id),
          aggregate,
          totalTokens,
          totalCostUsd: totalCost,
          cases: rows,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(`Report saved to ${outPath}`);
  }
}

if (process.argv[1]?.endsWith("live-cli.ts") || process.argv[1]?.endsWith("live-cli.js")) {
  runLiveEvaluation(parseArgs(process.argv.slice(2))).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
