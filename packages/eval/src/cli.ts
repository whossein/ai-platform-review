import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { evaluateCase } from "./metrics.js";
import type { BenchmarkCase, CandidateFinding } from "./types.js";

export async function runMockEvaluation(datasetPath?: string) {
  const p =
    datasetPath ||
    resolve(process.cwd(), "packages/eval/datasets/synthetic/v1/cases.json");

  if (!existsSync(p)) {
    console.error(`Dataset not found at ${p}`);
    process.exit(1);
  }

  const cases: BenchmarkCase[] = JSON.parse(readFileSync(p, "utf-8"));
  console.log(`\n========================================================`);
  console.log(`  AI REVIEW PLATFORM — EVALUATION HARNESS (v0.2.2)`);
  console.log(`========================================================`);
  console.log(`Loaded ${cases.length} benchmark case(s) from ${p}\n`);

  for (const c of cases) {
    console.log(`Evaluating case: [${c.id}] ${c.name}...`);

    // Mock candidates simulating deterministic review pipeline output
    const mockDelivered: CandidateFinding[] = [
      {
        id: "mock-c1",
        title: "Unsanitized token vulnerability",
        description: "Must sanitize token parameter",
        reason: "sanitize token properly",
        location: { file: "src/auth.ts", line: 20, endLine: 25 },
        category: "security",
        severity: "critical",
        accepted: true,
      },
    ];

    const report = evaluateCase(
      mockDelivered,
      [],
      c.expectedFindings,
      c.antiFindings,
      c.id
    );

    console.log(`Status: ${report.status}`);
    console.log(
      `Counts: TP=${report.counts.tp}, FP=${report.counts.fp}, FN=${report.counts.fn}, Q=${report.counts.q}, UQ=${report.counts.uq}`
    );
    console.log(
      `Confirmed Precision: ${(report.metrics.confirmedPrecision * 100).toFixed(1)}%`
    );
    console.log(
      `Conservative Precision: ${(report.metrics.conservativePrecision * 100).toFixed(1)}%`
    );
    console.log(
      `Conservative Recall: ${
        report.metrics.conservativeRecall === "N/A"
          ? "N/A"
          : `${(report.metrics.conservativeRecall * 100).toFixed(1)}%`
      }`
    );
    console.log(
      `Conservative F1: ${
        report.metrics.conservativeF1 === "N/A"
          ? "N/A"
          : `${(report.metrics.conservativeF1 * 100).toFixed(1)}%`
      }`
    );
    console.log(
      `UAR: ${(report.metrics.uar * 100).toFixed(1)}% | FDPC: ${report.metrics.fdpc} | Filtered Recall Loss: ${
        report.metrics.filteredRecallLoss === "N/A"
          ? "N/A"
          : `${(report.metrics.filteredRecallLoss * 100).toFixed(1)}%`
      }`
    );
    console.log(`--------------------------------------------------------\n`);
  }
}

if (process.argv[1]?.endsWith("cli.ts") || process.argv[1]?.endsWith("cli.js")) {
  runMockEvaluation().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
