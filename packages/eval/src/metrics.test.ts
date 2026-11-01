import { describe, it, expect } from "vitest";
import { evaluateCase } from "./metrics.js";
import type {
  CandidateFinding,
  ExpectedFinding,
  AntiFinding,
} from "./types.js";

describe("Evaluation Metrics Unit Tests", () => {
  it("validates full worked numerical example exactly", () => {
    const expectedFindings: ExpectedFinding[] = [
      {
        id: "E1",
        file: "src/auth.ts",
        lineRange: [20, 25],
        category: "security",
        severity: "critical",
        requiredKeywords: ["sanitize", "token"],
        description: "Token must be sanitized",
      },
      {
        id: "E2",
        file: "src/api.ts",
        lineRange: [50, 55],
        category: "performance",
        severity: "high",
        requiredKeywords: ["cache"],
        description: "Missing caching layer",
      },
      {
        id: "E3",
        file: "src/utils.ts",
        lineRange: [80, 85],
        category: "code",
        severity: "medium",
        requiredKeywords: ["leak"],
        description: "Potential memory leak",
      },
    ];

    const antiFindings: AntiFinding[] = [
      {
        id: "A1",
        file: "src/api.ts",
        lineRange: [50, 55],
        triggerKeywords: ["cache", "in-memory"],
        explanation: "InMemory cache is intentional",
      },
    ];

    const deliveredCandidates: CandidateFinding[] = [
      {
        id: "C1",
        title: "Unsanitized token vulnerability",
        description: "Must sanitize token",
        reason: "sanitize token properly",
        location: { file: "src/auth.ts", line: 20, endLine: 25 },
        category: "security",
        severity: "critical",
        accepted: true,
      },
      {
        id: "C2",
        title: "Missing in-memory cache",
        description: "Add cache in-memory",
        reason: "cache in-memory required",
        location: { file: "src/api.ts", line: 50, endLine: 55 },
        category: "performance",
        severity: "high",
        accepted: true,
      },
      {
        id: "C3",
        title: "Add test for in-memory cache",
        description: "Testing cache in-memory",
        reason: "cache in-memory needs test",
        location: { file: "src/api.ts", line: 50, endLine: 55 },
        category: "testing", // testing is incompatible with E2 performance, E1, E3
        severity: "low",
        accepted: true,
      },
      {
        id: "C4",
        title: "Variable name too short",
        description: "Rename x to counter",
        reason: "code style",
        location: { file: "src/other.ts", line: 10, endLine: 12 },
        category: "code",
        severity: "low",
        accepted: true,
      },
    ];

    const rejectedCandidates: CandidateFinding[] = [
      {
        id: "J1",
        title: "Memory leak in loop",
        description: "Leak detected in buffer",
        reason: "leak present",
        location: { file: "src/utils.ts", line: 80, endLine: 85 },
        category: "code",
        severity: "medium",
        accepted: false,
      },
    ];

    const result = evaluateCase(
      deliveredCandidates,
      rejectedCandidates,
      expectedFindings,
      antiFindings
    );

    // Counts
    expect(result.counts.tp).toBe(1);
    expect(result.counts.fp).toBe(2);
    expect(result.counts.fpTrap).toBe(1);
    expect(result.counts.fpSpurious).toBe(1);
    expect(result.counts.fn).toBe(2);
    expect(result.counts.q).toBe(1);
    expect(result.counts.uq).toBe(1);

    // Conservation identities
    expect(result.counts.tp + result.counts.fn).toBe(expectedFindings.length); // 1 + 2 = 3
    expect(result.counts.tp + result.counts.fp + result.counts.q).toBe(
      deliveredCandidates.length
    ); // 1 + 2 + 1 = 4

    // Metric assertions
    expect(result.metrics.confirmedPrecision).toBeCloseTo(1 / 3, 4);
    expect(result.metrics.conservativePrecision).toBeCloseTo(0.25, 4);
    expect(result.metrics.conservativeRecall).toBeCloseTo(1 / 3, 4);
    expect(result.metrics.conservativeF1).toBeCloseTo(2 / 7, 4);

    expect(result.metrics.optimisticPrecision).toBeCloseTo(0.50, 4);
    expect(result.metrics.optimisticRecall).toBeCloseTo(2 / 3, 4);
    expect(result.metrics.optimisticF1).toBeCloseTo(4 / 7, 4);

    expect(result.metrics.pessimisticPrecision).toBeCloseTo(0.25, 4);
    expect(result.metrics.pessimisticRecall).toBeCloseTo(1 / 3, 4);
    expect(result.metrics.pessimisticF1).toBeCloseTo(2 / 7, 4);

    expect(result.metrics.aftr).toBeCloseTo(1.0, 4);
    expect(result.metrics.fdpc).toBe(3);
    expect(result.metrics.uar).toBeCloseTo(0.75, 4);
    expect(result.metrics.filteredRecallLoss).toBeCloseTo(1 / 3, 4);

    // Diagnostics
    expect(result.diagnostics.judgeFalseRejectionsClean).toBe(1);
    expect(result.diagnostics.judgeFalseRejectionsContested).toBe(0);
    expect(result.diagnostics.judgeFalseRejectionsTotal).toBe(1);
    expect(result.diagnostics.specialistRecall).toBe("N/A");
    expect(result.diagnostics.criticFilterRate).toBe("N/A");
    expect(result.status).toBe("PENDING_HUMAN_ADJUDICATION");
  });

  it("handles empty sets without division by zero errors", () => {
    const cleanDiffResult = evaluateCase([], [], [], []);
    expect(cleanDiffResult.metrics.confirmedPrecision).toBe(1.0);
    expect(cleanDiffResult.metrics.conservativePrecision).toBe(1.0);
    expect(cleanDiffResult.metrics.conservativeRecall).toBe("N/A");
    expect(cleanDiffResult.metrics.conservativeF1).toBe("N/A");
    expect(cleanDiffResult.metrics.pessimisticF1).toBe("N/A");
    expect(cleanDiffResult.metrics.aftr).toBe("N/A");
    expect(cleanDiffResult.metrics.fdpc).toBe(0);
    expect(cleanDiffResult.metrics.uar).toBe(0.0);
    expect(cleanDiffResult.metrics.filteredRecallLoss).toBe("N/A");
    expect(cleanDiffResult.status).toBe("COMPLETE");
  });

  it("enforces strict '>' quarantine policy: clean candidate with strictly higher weight rescues E, equal weight stays contested", () => {
    const expected: ExpectedFinding[] = [
      {
        id: "E1",
        file: "src/api.ts",
        lineRange: [50, 50],
        category: "performance",
        severity: "high",
        requiredKeywords: ["query", "batch"],
        description: "Batch query needed",
      },
    ];
    const anti: AntiFinding[] = [
      {
        id: "A1",
        file: "src/api.ts",
        lineRange: [50, 50],
        triggerKeywords: ["cache"],
        explanation: "Intentional no-cache",
      },
    ];

    // Quarantined candidate Q1: matches E1 and A1 with exact line/cat/sev/keywords (1,000,000) or lower weight
    const qCandLower: CandidateFinding = {
      id: "Q1",
      title: "Add cache or query",
      description: "",
      reason: "",
      location: { file: "src/api.ts", line: 52, endLine: 52 }, // line slack 2 -> 100k line, 1/2 kw -> 25k => 875,000
      category: "performance",
      severity: "high",
    };

    // Clean candidate C_higher: exact match on E1 (weight 1,000,000 > 875,000), does not trigger A1 ("cache")
    const cHigher: CandidateFinding = {
      id: "C_higher",
      title: "Batch query optimization",
      description: "Use batch query",
      reason: "",
      location: { file: "src/api.ts", line: 50, endLine: 50 },
      category: "performance",
      severity: "high",
    };

    const rescuedReport = evaluateCase([qCandLower, cHigher], [], expected, anti);
    expect(rescuedReport.counts.tp).toBe(1);
    expect(rescuedReport.counts.q).toBe(1);
    expect(rescuedReport.counts.uq).toBe(0); // E1 was rescued by C_higher, so C is empty!
    expect(rescuedReport.counts.fn).toBe(0);

    // Equal-weight tie: C_equal has exact same weight (875,000) as Q1 (875,000)
    const cEqual: CandidateFinding = {
      id: "C_equal",
      title: "Use query optimization",
      description: "",
      reason: "",
      location: { file: "src/api.ts", line: 52, endLine: 52 },
      category: "performance",
      severity: "high",
    };

    const tiedReport = evaluateCase([qCandLower, cEqual], [], expected, anti);
    // Under strict '>', equal weight does NOT rescue E1: E1 remains contested!
    expect(tiedReport.counts.tp).toBe(0);
    expect(tiedReport.counts.fp).toBe(1); // C_equal becomes unmatched clean FP
    expect(tiedReport.counts.q).toBe(1);
    expect(tiedReport.counts.uq).toBe(1); // E1 is in C and matched by Q1 in UQ
    expect(tiedReport.counts.fn).toBe(1);
  });

  it("enforces 1-to-1 matching on judgeFalseRejections and rejects duplicate IDs across all sets", () => {
    const e1: ExpectedFinding = {
      id: "E1",
      file: "src/a.ts",
      lineRange: [10, 10],
      category: "security",
      severity: "high",
      requiredKeywords: ["sanitize"],
      description: "",
    };
    const r1: CandidateFinding = {
      id: "R1",
      title: "sanitize input",
      description: "",
      reason: "",
      location: { file: "src/a.ts", line: 10 },
      category: "security",
      severity: "high",
    };
    const r2: CandidateFinding = {
      id: "R2",
      title: "sanitize input duplicate",
      description: "",
      reason: "",
      location: { file: "src/a.ts", line: 10 },
      category: "security",
      severity: "high",
    };

    // Two rejected candidates pointing to the same single missed E1 must count as 1 false rejection, not 2
    const rep = evaluateCase([], [r1, r2], [e1], []);
    expect(rep.diagnostics.judgeFalseRejectionsClean).toBe(1);
    expect(rep.metrics.filteredRecallLoss).toBe(1.0);

    // Duplicate ID in antiFindings or rejectedCandidates must throw
    expect(() => evaluateCase([], [r1, r1], [e1], [])).toThrow(
      "Duplicate rejected candidate ID found: R1"
    );
  });
});
