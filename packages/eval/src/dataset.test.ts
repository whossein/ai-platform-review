import { describe, it, expect } from "vitest";
import { parseDiffToFiles } from "@ai-review/git";
import { loadDataset, validateCase, RULE_DETECTABLE_TAG } from "./dataset.js";
import type { BenchmarkCase } from "./types.js";

describe("synthetic v2 dataset", () => {
  const cases = loadDataset();

  it("has about ten uniquely named cases, honestly labelled synthetic", () => {
    expect(cases.length).toBeGreaterThanOrEqual(10);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    for (const c of cases) {
      expect(c.origin).toBe("synthetic_unit");
      expect(c.tags).toContain("synthetic");
    }
  });

  it("every diff parses to at least one file that exists in inputFiles", () => {
    for (const c of cases) {
      const files = parseDiffToFiles(c.diff);
      expect(files.length, c.id).toBeGreaterThan(0);
      const inputs = new Set(c.inputFiles.map((f) => f.path));
      for (const f of files) expect(inputs.has(f.path), `${c.id}:${f.path}`).toBe(true);
    }
  });

  it("annotations point at files in the diff, within the new file's line count", () => {
    for (const c of cases) {
      const lineCount = new Map(
        c.inputFiles.map((f) => [f.path, f.content.replace(/\n$/, "").split("\n").length]),
      );
      for (const a of [...c.expectedFindings, ...c.antiFindings]) {
        const n = lineCount.get(a.file);
        expect(n, `${c.id}:${a.id} file`).toBeDefined();
        expect(a.lineRange[1], `${c.id}:${a.id} range`).toBeLessThanOrEqual(n!);
      }
    }
  });

  it("tags at least one rule-detectable case", () => {
    expect(cases.some((c) => c.tags.includes(RULE_DETECTABLE_TAG))).toBe(true);
  });

  it("validateCase rejects a bad range and a diff without hunks", () => {
    const base = structuredClone(cases[0]!) as BenchmarkCase;
    expect(() => validateCase({ ...base, diff: "no hunks" })).toThrow(/hunk/);
    const bad = structuredClone(base);
    bad.expectedFindings[0]!.lineRange = [5, 2];
    expect(() => validateCase(bad)).toThrow(/lineRange/);
  });
});
