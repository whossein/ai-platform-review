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
});
