import { describe, it, expect } from "vitest";
import type { AgentRuntime, AgentExecutionContext, ContextSlice, WorkflowStage } from "@ai-review/core";
import { ReviewStageExecutor, type ReviewExecutionContext } from "./executor.js";
import { ReservableBudgetGuard } from "./budget.js";

function makeCtx(runtime: AgentRuntime): ReviewExecutionContext {
  const slice = { handle: "ctx", version: 1, files: [], rendered: "x", estimatedTokens: 10, compressed: false } as unknown as ContextSlice;
  const guard = new ReservableBudgetGuard({ tokenBudget: 1_000_000, dollarBudget: 100, executionBudgetMs: 100_000 });
  return {
    diff: "",
    slice,
    baseCtx: { reviewId: "r", llm: { complete: async () => ({ ok: false }) } } as unknown as AgentExecutionContext,
    runtime,
    reservableGuard: guard,
    pricing: new Map(),
    threshold: 0.6,
    startedAt: Date.now(),
    deterministicIssues: [],
    allIssues: [],
    agentMetrics: [],
    agentErrors: [],
    consolidatedIssues: [],
    adjudicatedIssues: [],
    markdownReport: "",
    jsonReport: "",
  };
}

const agentStage = { id: "stage.a", kind: "agent", agentId: "agent.x", dependsOn: [] } as unknown as WorkflowStage;
const budget = {} as never;

describe("ReviewStageExecutor agent failures", () => {
  it("records a specialist that throws, once, and releases its reservation", async () => {
    const ctx = makeCtx({
      execute: async () => {
        throw new Error("handler exploded");
      },
    });
    const outcome = await new ReviewStageExecutor(ctx).execute(agentStage, budget);
    expect(outcome).toEqual({ ok: true, value: { kind: "failed", reason: "handler exploded" } });
    expect(ctx.agentErrors).toEqual([{ agentId: "agent.x", message: "handler exploded" }]);
    expect(ctx.agentMetrics).toHaveLength(1);
    expect(ctx.reservableGuard.status().exceeded).toEqual([]);
  });

  it("does not double-record a failure the retry path already recorded", async () => {
    const ctx = makeCtx({
      execute: async () => ({
        ok: false,
        error: { category: "provider", code: "llm.rate_limited", message: "429", retryable: true },
      }),
    });
    const executor = new ReviewStageExecutor(ctx);
    await executor.execute(agentStage, budget, { attempt: 1, maxAttempts: 2 });
    expect(ctx.agentErrors).toHaveLength(0);
    await executor.execute(agentStage, budget, { attempt: 2, maxAttempts: 2 });
    expect(ctx.agentErrors).toHaveLength(1);
    expect(ctx.agentMetrics).toHaveLength(1);
  });

  it("does not turn a thrown error of a non-agent stage into an agent error", async () => {
    const ctx = makeCtx({ execute: async () => ({ ok: false, error: {} as never }) });
    const executor = new ReviewStageExecutor(ctx);
    (executor as any).executeJudge = async () => {
      throw new Error("judge broke");
    };
    const outcome = await executor.execute({ id: "stage.judge", kind: "judge", dependsOn: [] } as unknown as WorkflowStage, budget);
    expect(outcome).toEqual({ ok: true, value: { kind: "failed", reason: "judge broke" } });
    expect(ctx.agentErrors).toHaveLength(0);
  });
});
