import { DefaultRuleEngine, MapRuleRegistry, DEFAULT_RULES, ruleFindingToIssue } from "@ai-review/config";
import type { FileRuleContext } from "@ai-review/config";
import { parseDiffToFiles } from "@ai-review/git";
import { evaluateCase } from "./metrics.js";
import { issueToCandidate } from "./convert.js";
import { loadDataset, RULE_DETECTABLE_TAG, SYNTHETIC_V2_PATH } from "./dataset.js";
import { aggregateCounts, formatAggregate, pct } from "./summary.js";
import type { BenchmarkCase, CandidateFinding, EvaluationReport } from "./types.js";

/** Runs only the deterministic rule engine over a case's diff. */
export async function runRulesOnCase(c: BenchmarkCase): Promise<CandidateFinding[]> {
  const registry = new MapRuleRegistry();
  for (const rule of DEFAULT_RULES) registry.register(rule);
  const engine = new DefaultRuleEngine(registry);
  const ctx: FileRuleContext = {
    repositoryId: "repo.eval",
    files: parseDiffToFiles(c.diff),
  };
  const res = await engine.run(ctx);
  if (!res.ok) return [];
  return res.value.findings.map((f, i) => issueToCandidate(ruleFindingToIssue(f), i));
}

export async function runRulesEvaluation(datasetPath: string = SYNTHETIC_V2_PATH) {
  const cases = loadDataset(datasetPath);
  console.log(`\nRule-engine evaluation (no LLM) — ${cases.length} cases from ${datasetPath}`);
  console.log(`Origin: synthetic, hand-written; scores are only meaningful relative to each other.\n`);

  const reports: Array<{ c: BenchmarkCase; report: EvaluationReport }> = [];
  for (const c of cases) {
    const found = await runRulesOnCase(c);
    const report = evaluateCase(found, [], c.expectedFindings, c.antiFindings, c.id);
    reports.push({ c, report });
    const k = report.counts;
    console.log(
      `[${c.id}] findings=${found.length} TP=${k.tp} FP=${k.fp} FN=${k.fn} ` +
        `precision=${pct(k.totalDelivered ? k.tp / k.totalDelivered : "N/A")} ` +
        `recall=${pct(k.totalExpected ? k.tp / k.totalExpected : "N/A")}`,
    );
    for (const f of found) {
      console.log(`    - ${f.severity} ${f.category} ${f.location.file}:${f.location.line ?? "?"} ${f.title}`);
    }
  }

  const detectable = reports.filter((r) => r.c.tags.includes(RULE_DETECTABLE_TAG));
  console.log("");
  console.log(formatAggregate("rule-detectable cases", aggregateCounts(detectable.map((r) => r.report))));
  console.log(formatAggregate("ALL cases           ", aggregateCounts(reports.map((r) => r.report))));
  console.log(`(Rules are expected to miss semantic findings; full recall is not a goal for this mode.)\n`);
}

if (process.argv[1]?.endsWith("rules-cli.ts") || process.argv[1]?.endsWith("rules-cli.js")) {
  runRulesEvaluation().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
