import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import type { BenchmarkCase } from "./types.js";

/** Tag marking cases a deterministic rule can catch without an LLM. */
export const RULE_DETECTABLE_TAG = "rule-detectable";

export const SYNTHETIC_V2_PATH = fileURLToPath(
  new URL("../datasets/synthetic/v2/cases.json", import.meta.url),
);

const SEVERITIES = new Set(["info", "low", "medium", "high", "critical"]);

function assertRange(range: unknown, where: string): void {
  if (
    !Array.isArray(range) ||
    range.length !== 2 ||
    !range.every((n) => Number.isSafeInteger(n) && n > 0) ||
    range[0] > range[1]
  ) {
    throw new Error(`${where}: lineRange must be [start, end] with 0 < start <= end`);
  }
}

/** Throws a descriptive error when a case is malformed. */
export function validateCase(c: BenchmarkCase): void {
  const where = `case ${c?.id ?? "<no id>"}`;
  if (!c.id || !c.name) throw new Error(`${where}: id and name are required`);
  if (!c.diff || !c.diff.includes("@@ ")) {
    throw new Error(`${where}: diff must be a unified diff with hunk headers`);
  }
  if (!Array.isArray(c.tags)) throw new Error(`${where}: tags must be an array`);
  for (const e of c.expectedFindings) {
    assertRange(e.lineRange, `${where} expected ${e.id}`);
    if (!SEVERITIES.has(e.severity)) {
      throw new Error(`${where} expected ${e.id}: bad severity ${e.severity}`);
    }
    if (!e.file || !e.category) {
      throw new Error(`${where} expected ${e.id}: file and category are required`);
    }
  }
  for (const a of c.antiFindings) {
    assertRange(a.lineRange, `${where} anti ${a.id}`);
    if (!a.file) throw new Error(`${where} anti ${a.id}: file is required`);
  }
}

export function loadDataset(path: string = SYNTHETIC_V2_PATH): BenchmarkCase[] {
  const cases = JSON.parse(readFileSync(path, "utf-8")) as BenchmarkCase[];
  if (!Array.isArray(cases)) throw new Error(`${path}: expected a JSON array`);
  const ids = new Set<string>();
  for (const c of cases) {
    validateCase(c);
    if (ids.has(c.id)) throw new Error(`Duplicate case id: ${c.id}`);
    ids.add(c.id);
  }
  return cases;
}
