import { describe, it, expect } from "vitest";
import { issueToCandidate, mapCategory } from "./convert.js";
import { evaluateCase } from "./metrics.js";
import { aggregateCounts, ratio, pct } from "./summary.js";

const issue = {
  id: "issue.abc",
  title: "security.sql-injection",
  description: "SQL built by interpolation",
  reason: "Deterministic rule matched",
  severity: "high" as const,
  category: "security",
  location: { file: "src/db.ts", line: 4 },
  producedBy: "agent.rule-engine",
};

describe("issueToCandidate", () => {
  it("copies the fields the matcher reads and keeps ids unique by index", () => {
    const a = issueToCandidate(issue, 0);
    const b = issueToCandidate(issue, 1);
    expect(a.id).not.toBe(b.id);
    expect(a).toMatchObject({
      title: issue.title,
      category: "security",
      severity: "high",
      location: { file: "src/db.ts", line: 4 },
      accepted: true,
      producedBy: "agent.rule-engine",
    });
    expect(a.location).not.toHaveProperty("endLine");
    expect(a).not.toHaveProperty("suggestion");
  });

  it("carries endLine, suggestion and the accepted flag when present", () => {
    const c = issueToCandidate(
      { ...issue, location: { file: "a.ts", line: 2, endLine: 5 }, suggestion: { description: "use params" } },
      0,
      false,
    );
    expect(c.location).toEqual({ file: "a.ts", line: 2, endLine: 5 });
    expect(c.suggestion).toBe("use params");
    expect(c.accepted).toBe(false);
  });
});

describe("aggregateCounts", () => {
  const counts = (tp: number, fp: number, fn: number, d: number, e: number) =>
    ({ counts: { tp, fp, fn, totalDelivered: d, totalExpected: e } }) as never;

  it("micro-averages and reports N/A on empty denominators", () => {
    const a = aggregateCounts([counts(1, 1, 0, 2, 1), counts(1, 0, 1, 1, 2)]);
    expect(a.precision).toBeCloseTo(2 / 3);
    expect(a.recall).toBeCloseTo(2 / 3);
    expect(aggregateCounts([counts(0, 0, 0, 0, 0)]).precision).toBe("N/A");
    expect(ratio(1, 0)).toBe("N/A");
    expect(pct(0.5)).toBe("50.0%");
  });
});

describe("mapCategory", () => {
  it("maps producer categories into the matcher taxonomy", () => {
    expect(mapCategory("react")).toBe("code");
    expect(mapCategory("typescript")).toBe("code");
    expect(mapCategory("python")).toBe("code");
    expect(mapCategory("code_quality")).toBe("code");
    expect(mapCategory("bug")).toBe("correctness");
    expect(mapCategory("error-handling")).toBe("correctness");
    expect(mapCategory("Vulnerability")).toBe("security");
    expect(mapCategory("perf")).toBe("performance");
  });
  it("keeps security, performance and correctness identity", () => {
    expect(mapCategory("security")).toBe("security");
    expect(mapCategory("performance")).toBe("performance");
    expect(mapCategory("correctness")).toBe("correctness");
    expect(mapCategory("architecture")).toBe("architecture");
  });
  it("passes unknown categories through unchanged", () => {
    expect(mapCategory("Totally-New")).toBe("Totally-New");
    expect(issueToCandidate({ ...issue, category: "validation" }, 0).category).toBe("validation");
  });
  it("scores a bug finding as TP against an expected code finding", () => {
    const cand = issueToCandidate(
      {
        ...issue,
        category: "bug",
        title: "Stale closure in effect",
        description: "The stale value is captured",
        location: { file: "src/App.tsx", line: 8 },
      },
      0,
    );
    expect(cand.category).toBe("correctness");
    const report = evaluateCase(
      [cand],
      [],
      [
        {
          id: "E1",
          file: "src/App.tsx",
          lineRange: [7, 9],
          category: "code",
          severity: "high",
          requiredKeywords: ["stale"],
          description: "stale closure",
        },
      ],
      [],
      "c2",
    );
    expect(report.counts.tp).toBe(1);
    expect(report.counts.fp).toBe(0);
    expect(report.counts.fn).toBe(0);
  });

  it("scores a react finding as TP against an expected code finding", () => {
    const cand = issueToCandidate(
      {
        ...issue,
        category: "react",
        title: "Stale closure in effect",
        description: "The stale value is captured",
        location: { file: "src/App.tsx", line: 8 },
      },
      0,
    );
    const report = evaluateCase(
      [cand],
      [],
      [
        {
          id: "E1",
          file: "src/App.tsx",
          lineRange: [7, 9],
          category: "code",
          severity: "high",
          requiredKeywords: ["stale"],
          description: "stale closure",
        },
      ],
      [],
      "c1",
    );
    expect(report.counts.tp).toBe(1);
    expect(report.counts.fp).toBe(0);
    expect(report.counts.fn).toBe(0);
  });
});
