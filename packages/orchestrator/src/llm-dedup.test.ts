import { describe, it, expect } from "vitest";
import type {
  AgentExecutionContext,
  AgentId,
  AgentRuntime,
  ContentHash,
  ContextSlice,
  Issue,
  IssueId,
  LLMRequest,
  WorkflowStage,
} from "@ai-review/core";
import { llmDedup } from "./llm-dedup.js";
import { critique, type CritiquedIssue } from "./critic.js";
import { ReviewStageExecutor, type ReviewExecutionContext } from "./executor.js";
import { ReservableBudgetGuard } from "./budget.js";

const WORDING: Record<string, { title: string; description: string }> = {
  a: { title: "Reader never closed", description: "File descriptors leak on every call" },
  b: { title: "Unbounded resource retention", description: "Stream stays open across requests" },
  c: { title: "Slow IO path", description: "Blocking reads inside the hot loop" },
  d: { title: "Null dereference", description: "Value can be missing here" },
};

function mk(id: string, producedBy: string, line: number, extra: Partial<Issue> = {}): Issue {
  return {
    id: id as IssueId,
    ...WORDING[id]!,
    severity: "medium",
    confidence: 0.8,
    reason: "because",
    location: { file: "src/a.ts", line },
    references: [],
    category: `cat-${id}`,
    producedBy: producedBy as AgentId,
    fingerprint: `fp-${id}` as ContentHash,
    ...extra,
  };
}

type Complete = (req: Omit<LLMRequest, "model">) => Promise<unknown>;

function llmReturning(content: string, calls: Omit<LLMRequest, "model">[] = []) {
  return {
    complete: (async (req: Omit<LLMRequest, "model">) => {
      calls.push(req);
      return {
        ok: true,
        value: {
          model: "m",
          content,
          usage: { promptTokens: 100, completionTokens: 20 },
          finishReason: "stop",
        },
      };
    }) as unknown as Complete,
  } as never;
}

const three: CritiquedIssue[] = critique([
  mk("a", "agent.p1", 5, { severity: "low", confidence: 0.7 }),
  mk("b", "agent.p2", 5, { severity: "high", confidence: 0.6 }),
  mk("c", "agent.p3", 5),
  mk("d", "agent.p1", 9),
]);

describe("llmDedup", () => {
  it("merges findings the model says are the same defect", async () => {
    const calls: Omit<LLMRequest, "model">[] = [];
    const res = await llmDedup(
      three,
      llmReturning('{"groups":[{"group":1,"same":[[1,2]]}]}', calls),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.preferredTier).toBe("cheap");
    expect(calls[0]!.jsonSchema).toBeDefined();
    expect(JSON.stringify(calls[0]!.messages)).toContain("<candidate_groups>");
    expect(res.issues).toHaveLength(3);
    const merged = res.issues.find((i) => i.corroboratedBy.length === 2)!;
    expect(merged.severity).toBe("high");
    expect(merged.confidence).toBeGreaterThanOrEqual(0.7);
    expect(merged.corroboratedBy).toEqual(["agent.p1", "agent.p2"]);
    expect(res.merged).toBe(1);
  });

  it("keeps findings separate when the model says they differ", async () => {
    const res = await llmDedup(three, llmReturning('{"groups":[]}'));
    expect(res.issues).toHaveLength(4);
    expect(res.merged).toBe(0);
  });

  it("leaves findings untouched on invalid JSON, errors and throws", async () => {
    for (const llm of [
      llmReturning("not json"),
      llmReturning('{"nope":1}'),
      { complete: async () => ({ ok: false, error: { message: "boom" } }) } as never,
      { complete: async () => { throw new Error("timeout"); } } as never,
    ]) {
      const res = await llmDedup(three, llm);
      expect(res.issues).toEqual(three);
      expect(res.merged).toBe(0);
    }
  });

  it("makes no call without candidate groups", async () => {
    const calls: Omit<LLMRequest, "model">[] = [];
    const solo = critique([mk("a", "agent.p1", 1), mk("b", "agent.p2", 2)]);
    const res = await llmDedup(solo, llmReturning('{"groups":[]}', calls));
    expect(calls).toHaveLength(0);
    expect(res.called).toBe(false);
  });

  it("never merges across lines, even if the model asks", async () => {
    // Group 1 is line 5 (a,b,c); finding 4 (line 9) is not in any group.
    const res = await llmDedup(
      three,
      llmReturning('{"groups":[{"group":1,"same":[[1,4]]},{"group":2,"same":[[1,2]]}]}'),
    );
    expect(res.issues).toHaveLength(4);
  });

  it("ignores findings in different groups of one merge set", async () => {
    const res = await llmDedup(three, llmReturning('{"groups":[{"group":1,"same":[[1,2,3]]}]}'));
    expect(res.issues).toHaveLength(2);
    expect(res.issues.find((i) => i.corroboratedBy.length === 3)).toBeDefined();
  });
});

describe("executor critic stage with AI_REVIEW_LLM_DEDUP", () => {
  const criticStage = { id: "stage.critic", kind: "critic", dependsOn: [] } as unknown as WorkflowStage;

  function makeCtx(llmDedupFlag: boolean, complete: Complete): ReviewExecutionContext {
    const slice = { handle: "c", version: 1, files: [], rendered: "x", estimatedTokens: 10, compressed: false } as unknown as ContextSlice;
    return {
      diff: "",
      slice,
      baseCtx: { reviewId: "r", llm: { complete } } as unknown as AgentExecutionContext,
      runtime: {} as AgentRuntime,
      reservableGuard: new ReservableBudgetGuard({ tokenBudget: 1_000_000, dollarBudget: 100, executionBudgetMs: 100_000 }),
      pricing: new Map(),
      threshold: 0.6,
      startedAt: Date.now(),
      llmDedup: llmDedupFlag,
      deterministicIssues: [],
      allIssues: [mk("a", "agent.p1", 5), mk("b", "agent.p2", 5)],
      agentMetrics: [],
      agentErrors: [],
      consolidatedIssues: [],
      adjudicatedIssues: [],
      markdownReport: "",
      jsonReport: "",
    };
  }

  it("does not call the model when the flag is off", async () => {
    let n = 0;
    const ctx = makeCtx(false, async () => { n++; return { ok: false }; });
    await new ReviewStageExecutor(ctx).execute(criticStage, {} as never);
    expect(n).toBe(0);
    expect(ctx.consolidatedIssues).toHaveLength(2);
  });

  it("merges, charges metrics and does not record an agent error", async () => {
    const llm = llmReturning('{"groups":[{"group":1,"same":[[1,2]]}]}') as unknown as { complete: Complete };
    const ctx = makeCtx(true, llm.complete);
    await new ReviewStageExecutor(ctx).execute(criticStage, {} as never);
    expect(ctx.consolidatedIssues).toHaveLength(1);
    expect(ctx.agentMetrics).toHaveLength(1);
    expect(ctx.agentMetrics[0]!.promptTokens).toBe(100);
    expect(ctx.agentErrors).toEqual([]);
  });

  it("keeps the deterministic result and records no error when the call fails", async () => {
    const ctx = makeCtx(true, async () => ({ ok: false, error: { message: "down" } }));
    await new ReviewStageExecutor(ctx).execute(criticStage, {} as never);
    expect(ctx.consolidatedIssues).toHaveLength(2);
    expect(ctx.agentErrors).toEqual([]);
    expect(ctx.reservableGuard.status().exceeded).toEqual([]);
  });
});
