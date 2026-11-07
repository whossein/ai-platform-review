import { describe, it, expect } from "vitest";
import { critique, normalizeCategory } from "./critic.js";
import type {
  AgentId,
  ContentHash,
  Issue,
  IssueId,
  Severity,
} from "@ai-review/core";

interface IssueInput {
  readonly id?: string;
  readonly producedBy: string;
  readonly severity?: Severity;
  readonly confidence?: number;
  readonly category?: string;
  readonly location?: { readonly file: string; readonly line?: number };
}

function issue(input: IssueInput): Issue {
  return {
    id: (input.id ?? "i.1") as IssueId,
    title: "Hardcoded secret",
    description: "desc",
    severity: input.severity ?? "high",
    confidence: input.confidence ?? 0.6,
    reason: "because",
    suggestion: { description: "fix it" },
    location: input.location ?? { file: "src/a.ts", line: 1 },
    references: [],
    category: input.category ?? "security",
    producedBy: input.producedBy as AgentId,
    fingerprint: "abc" as ContentHash,
  };
}

describe("critic / consolidation", () => {
  it("merges duplicate findings at the same file+line+category into one", () => {
    const out = critique([
      issue({ id: "a", producedBy: "agent.security-reviewer" }),
      issue({ id: "b", producedBy: "agent.code-reviewer" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.corroboratedBy).toHaveLength(2);
  });

  it("boosts confidence when reviewers corroborate, never exceeding 1", () => {
    const out = critique([
      issue({
        id: "a",
        confidence: 0.6,
        producedBy: "agent.security-reviewer",
      }),
      issue({ id: "b", confidence: 0.6, producedBy: "agent.code-reviewer" }),
    ]);
    expect(out[0]!.confidence).toBeGreaterThan(0.6);
    expect(out[0]!.confidence).toBeLessThanOrEqual(1);
  });

  it("keeps the highest severity as the representative", () => {
    const out = critique([
      issue({ id: "a", severity: "low", producedBy: "agent.code-reviewer" }),
      issue({
        id: "b",
        severity: "critical",
        producedBy: "agent.security-reviewer",
      }),
    ]);
    expect(out[0]!.severity).toBe("critical");
  });

  it("does not merge findings at different locations", () => {
    const out = critique([
      issue({
        id: "a",
        location: { file: "src/a.ts", line: 1 },
        producedBy: "x",
      }),
      issue({
        id: "b",
        location: { file: "src/a.ts", line: 9 },
        producedBy: "y",
      }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("leaves a single-agent finding unchanged in confidence", () => {
    const out = critique([
      issue({ id: "a", confidence: 0.72, producedBy: "solo" }),
    ]);
    expect(out[0]!.confidence).toBe(0.72);
    expect(out[0]!.corroboratedBy).toEqual(["solo"]);
  });

  it("merges the same defect when agents word the category differently", () => {
    const out = critique([
      issue({ id: "a", category: "security", producedBy: "agent.security-reviewer" }),
      issue({ id: "b", category: " Security Issue ", producedBy: "agent.code-reviewer" }),
      issue({ id: "c", category: "Vulnerability", producedBy: "agent.perf" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.corroboratedBy).toHaveLength(3);
    expect(normalizeCategory("Perf")).toBe("performance");
    expect(normalizeCategory("Logic")).toBe("correctness");
    expect(normalizeCategory("Naming")).toBe("style");
    expect(normalizeCategory("Custom Thing")).toBe("custom thing");
  });

  it("keeps two different issues from the same agent separate", () => {
    const a = { ...issue({ id: "a", producedBy: "solo" }), title: "SQL injection", fingerprint: "f1" as ContentHash };
    const b = { ...issue({ id: "b", producedBy: "solo" }), title: "Hardcoded key", fingerprint: "f2" as ContentHash };
    const out = critique([a, b]);
    expect(out).toHaveLength(2);
    expect(out.every((o) => o.corroboratedBy.length === 1)).toBe(true);
  });

  it("still collapses an identical repeat from the same agent", () => {
    const out = critique([
      issue({ id: "a", producedBy: "solo" }),
      issue({ id: "b", producedBy: "solo" }),
    ]);
    expect(out).toHaveLength(1);
  });

  it("keeps two different defects from different agents on one line separate", () => {
    const a = { ...issue({ id: "a", producedBy: "agent.x", confidence: 0.4 }), title: "SQL injection via string concat", description: "query built from user input", fingerprint: "f1" as ContentHash };
    const b = { ...issue({ id: "b", producedBy: "agent.y", confidence: 0.4 }), title: "Missing rate limiting", description: "endpoint allows unlimited attempts", fingerprint: "f2" as ContentHash };
    const out = critique([a, b]);
    expect(out).toHaveLength(2);
    expect(out.map((o) => o.confidence)).toEqual([0.4, 0.4]);
  });

  it("merges differently-titled findings that share enough wording", () => {
    const a = { ...issue({ id: "a", producedBy: "agent.x" }), title: "Hardcoded API key in source", description: "secret token committed", fingerprint: "f1" as ContentHash };
    const b = { ...issue({ id: "b", producedBy: "agent.y" }), title: "API key hardcoded in source", description: "secret token committed", fingerprint: "f2" as ContentHash };
    expect(critique([a, b])).toHaveLength(1);
  });

  it("merges a rule-engine security finding with an agent finding at the same location", () => {
    const rule = { ...issue({ id: "r", producedBy: "agent.rule-engine", confidence: 1 }), title: "secrets.aws-key", fingerprint: "f1" as ContentHash };
    const llm = { ...issue({ id: "l", producedBy: "agent.security-reviewer" }), title: "Leaked cloud credential", description: "unrelated words entirely", fingerprint: "f2" as ContentHash };
    const out = critique([rule, llm]);
    expect(out).toHaveLength(1);
    expect(out[0]!.corroboratedBy).toHaveLength(2);
  });

  it("does not merge a rule-engine finding with an agent finding outside security", () => {
    const rule = { ...issue({ id: "r", producedBy: "agent.rule-engine", category: "code" }), title: "code.todo", fingerprint: "f1" as ContentHash };
    const llm = { ...issue({ id: "l", producedBy: "agent.code-reviewer", category: "code" }), title: "Poor naming", description: "variable unclear", fingerprint: "f2" as ContentHash };
    expect(critique([rule, llm])).toHaveLength(2);
  });

  describe("non-transitive same-defect matching", () => {
    const wording = (
      id: string,
      producedBy: string,
      title: string,
      extra: Partial<Issue> = {},
    ): Issue => ({
      ...issue({ id, producedBy }),
      title,
      description: "",
      fingerprint: `fp-${id}` as ContentHash,
      ...extra,
    });

    const rule = () =>
      wording("r", "agent.rule-engine", "secret.hardcoded", { confidence: 1 });
    const code = () =>
      wording("c", "agent.code-reviewer", "alpha bravo charlie delta", {
        severity: "critical",
        confidence: 0.5,
      });
    const ts = () =>
      wording("t", "agent.typescript-reviewer", "alpha bravo charlie echo", {
        severity: "high",
      });
    const sec = () =>
      wording("s", "agent.security-reviewer", "zulu yankee xray whiskey", {
        severity: "critical",
        confidence: 0.8,
      });

    it("collapses rule + 3 agents with unrelated wording into one issue", () => {
      const out = critique([rule(), code(), ts(), sec()]);
      expect(out).toHaveLength(1);
      expect([...out[0]!.corroboratedBy].sort()).toEqual([
        "agent.code-reviewer",
        "agent.rule-engine",
        "agent.security-reviewer",
        "agent.typescript-reviewer",
      ]);
      // Representative: critical severity, then highest confidence (security-reviewer).
      expect(out[0]!.id).toBe("s");
      expect(out[0]!.severity).toBe("critical");
      expect(out[0]!.confidence).toBe(0.975); // 0.8 boosted for 4 contributors
    });

    it("gives the same result when the rule arrives last (clusters are bridged)", () => {
      const out = critique([code(), ts(), sec(), rule()]);
      expect(out).toHaveLength(1);
      expect(out[0]!.corroboratedBy).toHaveLength(4);
      expect(out[0]!.id).toBe("s");
    });

    it("chains: A~B and B~C join even though A and C share no wording", () => {
      const a = wording("a", "agent.a", "wa1 wa2 wa3 wa4");
      const b = wording("b", "agent.b", "wa1 wa2 wa3 wa4 wb1 wb2 wb3 wb4");
      const c = wording("c", "agent.c", "wb1 wb2 wb3 wb4");
      // Documented trade-off of "at least one" evidence: matches chain.
      expect(critique([a, b, c])).toHaveLength(1);
      // Without the bridging member, A and C stay apart.
      expect(critique([a, c])).toHaveLength(2);
    });

    it("never absorbs a second same-agent finding: a rule joins only one of them", () => {
      const s1 = wording("s1", "agent.security-reviewer", "SQL injection");
      const s2 = wording("s2", "agent.security-reviewer", "Hardcoded key");
      for (const order of [
        [rule(), s1, s2],
        [s1, s2, rule()],
      ]) {
        const out = critique(order);
        // Both distinct findings survive; the rule corroborates exactly one.
        expect(out).toHaveLength(2);
        expect(out.map((o) => o.corroboratedBy.length).sort()).toEqual([1, 2]);
        // The rule wins representative (same severity, confidence 1); the other
        // same-agent finding survives on its own.
        expect(out.map((o) => o.id).sort()).toEqual(["r", "s2"]);
      }
      // The rule goes to whichever same-agent finding comes first in the cluster
      // order (s1 here), which is arbitrary: the rule says nothing about which.
      const out = critique([s1, s2, rule()]);
      expect(out.find((o) => o.id === "s2")!.corroboratedBy).toEqual([
        "agent.security-reviewer",
      ]);
    });

    it("never joins with no evidence (cluster of only different same-producer issues)", () => {
      const x1 = wording("x1", "solo", "one two three");
      const x2 = wording("x2", "solo", "four five six");
      const y = wording("y", "agent.y", "seven eight nine");
      expect(critique([x1, x2, y])).toHaveLength(3);
    });
  });

  describe("cross-category matching", () => {
    const f = (
      id: string,
      producedBy: string,
      category: string,
      title: string,
      description = "",
      extra: Partial<Issue> = {},
    ): Issue => ({
      ...issue({ id, producedBy, category }),
      title,
      description,
      fingerprint: `fp-${id}` as ContentHash,
      ...extra,
    });

    it("merges an identical title filed under different categories", () => {
      const out = critique([
        f("a", "agent.performance-reviewer", "performance", "Stale closure in effect"),
        f("b", "agent.react-reviewer", "react", "Stale closure in effect"),
      ]);
      expect(out).toHaveLength(1);
      expect(out[0]!.corroboratedBy).toHaveLength(2);
    });

    it("merges overlapping wording across different categories", () => {
      const out = critique([
        f("a", "agent.code-reviewer", "correctness", "Stale closure reads old count", "effect callback captures stale count value"),
        f("b", "agent.react-reviewer", "react", "Effect callback captures stale count", "closure reads stale count value"),
      ]);
      expect(out).toHaveLength(1);
    });

    it("keeps different defects on one line separate across categories", () => {
      const out = critique([
        f("a", "agent.security-reviewer", "security", "SQL injection via string concat", "query built from user input"),
        f("b", "agent.performance-reviewer", "performance", "Unbounded loop over results", "iterates every row without paging"),
      ]);
      expect(out).toHaveLength(2);
    });

    it("keeps a security rule and a correctness agent finding separate", () => {
      const rule = f("r", "agent.rule-engine", "security", "secrets.aws-key", "", { confidence: 1 });
      const llm = f("l", "agent.code-reviewer", "correctness", "Off-by-one in loop bound", "index may exceed length");
      expect(critique([rule, llm])).toHaveLength(2);
      expect(critique([llm, rule])).toHaveLength(2);
    });

    it("picks the representative and corroboratedBy after a cross-category merge", () => {
      const out = critique([
        f("a", "agent.code-reviewer", "resource-management", "Reader never closed", "", { severity: "low", confidence: 0.5 }),
        f("b", "agent.security-reviewer", "security", "Reader never closed", "", { severity: "high", confidence: 0.6 }),
      ]);
      expect(out).toHaveLength(1);
      expect(out[0]!.id).toBe("b");
      expect(out[0]!.category).toBe("security");
      expect(out[0]!.severity).toBe("high");
      expect([...out[0]!.corroboratedBy].sort()).toEqual([
        "agent.code-reviewer",
        "agent.security-reviewer",
      ]);
      expect(out[0]!.confidence).toBe(0.8);
    });

    it("real LineReader example: differently-worded reports stay separate (conservative)", () => {
      const perf = f("p", "agent.performance-reviewer", "performance", "BufferedReader is never closed", "The BufferedReader opened here is never closed, leaking a file handle.");
      const code = f("c", "agent.code-reviewer", "resource-management", "Close the BufferedReader with try-with-resources", "Wrap the BufferedReader in try-with-resources so it is closed.");
      const sec = f("s", "agent.security-reviewer", "security", "File descriptor leak enables resource-exhaustion attacks", "Repeated calls exhaust file descriptors.");
      // Overlap is below SAME_DEFECT_MIN_OVERLAP even for perf vs code (one shared
      // identifier, different verbs), so none merge: two findings beat losing one.
      expect(critique([perf, code, sec])).toHaveLength(3);
    });
  });
});
