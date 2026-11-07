import { describe, it, expect } from "vitest";
import type { AgentRuntime, AgentExecutionContext, ContextSlice, WorkflowStage } from "@ai-review/core";
import { ReviewStageExecutor, type ReviewExecutionContext } from "./executor.js";
import { MarkdownReporter } from "@ai-review/reporting";
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

describe("ReviewStageExecutor cost accounting", () => {
  const run = (model: string, pricing: Map<string, { inputCostPer1M: number; outputCostPer1M: number }>) =>
    ({
      ...makeCtx({
        execute: async () => ({
          ok: true,
          value: { issues: [], model, usage: { promptTokens: 1_000_000, completionTokens: 1_000_000 } },
        }),
      } as unknown as AgentRuntime),
      pricing,
    }) as ReviewExecutionContext;

  it("uses the price table for priced models", async () => {
    const ctx = run("m", new Map([["m", { inputCostPer1M: 1, outputCostPer1M: 2 }]]));
    await new ReviewStageExecutor(ctx).execute(agentStage, budget);
    expect(ctx.agentMetrics[0]!.costUsd).toBe(3);
    expect(ctx.agentMetrics[0]!.costEstimated).toBeUndefined();
  });

  it("falls back to a conservative rate and flags unpriced models", async () => {
    const ctx = run("unknown", new Map());
    await new ReviewStageExecutor(ctx).execute(agentStage, budget);
    expect(ctx.agentMetrics[0]!.costUsd).toBe(20);
    expect(ctx.agentMetrics[0]!.costEstimated).toBe(true);
  });
});

describe("MarkdownReporter cost line", () => {
  const metrics = { reviewId: "r", totalExecutionMs: 1, totalPromptTokens: 1, totalCompletionTokens: 1, totalCostUsd: 0.0123, cacheHits: 0, cacheMisses: 0, agents: [] } as never;
  it("marks estimated cost", async () => {
    const r = await new MarkdownReporter().render({ issues: [], summary: "s", metrics: { ...(metrics as object), hasUnpricedModels: true } as never });
    expect((r as { value: { content: string } }).value.content).toContain("~$0.0123 (estimated, model not in price table)");
  });
  it("shows plain cost when priced", async () => {
    const r = await new MarkdownReporter().render({ issues: [], summary: "s", metrics });
    expect((r as { value: { content: string } }).value.content).toContain("$0.0123 ·");
    expect((r as { value: { content: string } }).value.content).not.toContain("estimated");
  });
});
