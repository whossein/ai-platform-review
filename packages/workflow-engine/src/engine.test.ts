/**
 * Workflow engine tests.
 *
 * Prove the engine's guarantees (ADR-0005): DAG validation, topological
 * ordering, parallel execution of independent stages, retry-until-maxRetries,
 * dependency-failure cascade, and budget-aware graceful degradation. All fakes
 * are in-memory — no agents, no LLM, no tokens.
 */

import { describe, it, expect } from "vitest";
import type {
  Budget,
  BudgetGuard,
  BudgetStatus,
  StageId,
  WorkflowDefinition,
  WorkflowStage,
} from "@ai-review/core";
import {
  DagWorkflowEngine,
  type StageExecutor,
  type StageOutcome,
} from "./engine.js";

const BUDGET: Budget = {
  tokenBudget: 1000,
  dollarBudget: 1,
  executionBudgetMs: 60000,
};

/** A budget guard that reports `exceeded` after `allowance` records. */
function makeGuardFactory(exceededFrom = Infinity): (b: Budget) => BudgetGuard {
  return () => {
    let records = 0;
    const build = (): BudgetStatus => ({
      budget: BUDGET,
      usage: { tokensUsed: 0, dollarsSpent: 0, elapsedMs: 0 },
      remainingTokens: 1000,
      remainingDollars: 1,
      remainingMs: 60000,
      exceeded: records >= exceededFrom ? ["token"] : [],
    });
    return {
      status: () => build(),
      record: () => {
        records++;
        return build();
      },
      canAfford: () => records < exceededFrom,
    };
  };
}

/** Backoff sleeper that records requested delays instead of waiting. */
function fastSleep(): { sleep: (ms: number) => Promise<void>; delays: number[] } {
  const delays: number[] = [];
  return {
    delays,
    sleep: async (ms) => {
      delays.push(ms);
    },
  };
}
const NO_JITTER = () => 0;

function stage(
  id: string,
  dependsOn: string[] = [],
  extra: Partial<WorkflowStage> = {},
): WorkflowStage {
  return {
    id: id as StageId,
    kind: "agent",
    dependsOn: dependsOn.map((d) => d as StageId),
    ...extra,
  };
}

function def(stages: WorkflowStage[]): WorkflowDefinition {
  return {
    id: "workflow.test" as WorkflowDefinition["id"],
    name: "test",
    description: "",
    stages,
  };
}

/** Executor that records execution order and applies per-stage scripted outcomes. */
function recordingExecutor(script: Record<string, StageOutcome[]> = {}): {
  executor: StageExecutor;
  order: string[];
} {
  const order: string[] = [];
  const calls: Record<string, number> = {};
  const executor: StageExecutor = {
    execute: async (s) => {
      order.push(s.id);
      const seq = script[s.id];
      const n = calls[s.id] ?? 0;
      calls[s.id] = n + 1;
      const outcome: StageOutcome = seq?.[Math.min(n, seq.length - 1)] ?? {
        kind: "completed",
      };
      return { ok: true, value: outcome };
    },
  };
  return { executor, order };
}

describe("DagWorkflowEngine validation", () => {
  it("rejects an unknown dependency", async () => {
    const { executor } = recordingExecutor();
    const engine = new DagWorkflowEngine(executor, makeGuardFactory());
    const res = await engine.run(def([stage("a", ["missing"])]), BUDGET);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("workflow.unknown_dependency");
  });

  it("rejects a duplicate stage id", async () => {
    const { executor } = recordingExecutor();
    const engine = new DagWorkflowEngine(executor, makeGuardFactory());
    const res = await engine.run(def([stage("a"), stage("a")]), BUDGET);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("workflow.duplicate_stage");
  });

  it("rejects a cycle", async () => {
    const { executor } = recordingExecutor();
    const engine = new DagWorkflowEngine(executor, makeGuardFactory());
    const res = await engine.run(
      def([stage("a", ["b"]), stage("b", ["a"])]),
      BUDGET,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("workflow.cycle_detected");
  });
});

describe("DagWorkflowEngine scheduling", () => {
  it("runs a linear chain in dependency order and completes", async () => {
    const { executor, order } = recordingExecutor();
    const engine = new DagWorkflowEngine(executor, makeGuardFactory());
    const res = await engine.run(
      def([stage("a"), stage("b", ["a"]), stage("c", ["b"])]),
      BUDGET,
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.status).toBe("completed");
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("runs independent specialists in parallel (one wave) after their dependency", async () => {
    const { executor, order } = recordingExecutor();
    const engine = new DagWorkflowEngine(executor, makeGuardFactory());
    // context → {react, security} → judge  (fan-out then fan-in)
    const res = await engine.run(
      def([
        stage("context"),
        stage("react", ["context"]),
        stage("security", ["context"]),
        stage("judge", ["react", "security"]),
      ]),
      BUDGET,
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.status).toBe("completed");
    // context first, judge last; react/security in the middle in either order.
    expect(order[0]).toBe("context");
    expect(order[3]).toBe("judge");
    expect(order.slice(1, 3).sort()).toEqual(["react", "security"]);
  });

  it("retries a retryable stage then succeeds within maxRetries", async () => {
    const { executor } = recordingExecutor({
      a: [{ kind: "retryable", reason: "transient" }, { kind: "completed" }],
    });
    const engine = new DagWorkflowEngine(executor, makeGuardFactory(), undefined, {
      sleep: fastSleep().sleep,
    });
    const res = await engine.run(
      def([stage("a", [], { maxRetries: 1 })]),
      BUDGET,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.status).toBe("completed");
      expect(res.value.stages[0]?.attempts).toBe(2);
    }
  });

  it("fails a stage that stays retryable beyond maxRetries", async () => {
    const { executor } = recordingExecutor({
      a: [{ kind: "retryable", reason: "always" }],
    });
    const engine = new DagWorkflowEngine(executor, makeGuardFactory(), undefined, {
      sleep: fastSleep().sleep,
    });
    const res = await engine.run(
      def([stage("a", [], { maxRetries: 2 })]),
      BUDGET,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.status).toBe("failed");
      expect(res.value.stages[0]?.attempts).toBe(3); // initial + 2 retries
    }
  });

  it("cascades: a dependent of a failed stage is skipped, run is failed", async () => {
    const { executor } = recordingExecutor({
      a: [{ kind: "failed", reason: "boom" }],
    });
    const engine = new DagWorkflowEngine(executor, makeGuardFactory());
    const res = await engine.run(def([stage("a"), stage("b", ["a"])]), BUDGET);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.status).toBe("failed");
      const b = res.value.stages.find((s) => s.stageId === ("b" as StageId));
      expect(b?.status).toBe("skipped");
    }
  });

  it("degrades gracefully when the budget is exhausted before a wave", async () => {
    // Budget is already exceeded from the very first check ⇒ everything skipped.
    const { executor, order } = recordingExecutor();
    const engine = new DagWorkflowEngine(executor, makeGuardFactory(0));
    const res = await engine.run(def([stage("a"), stage("b", ["a"])]), BUDGET);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.status).toBe("degraded");
    expect(order).toEqual([]); // nothing executed
  });
});

describe("DagWorkflowEngine backoff and optional stages", () => {
  it("backs off exponentially (capped) between retry attempts only", async () => {
    const { executor } = recordingExecutor({
      a: [{ kind: "retryable", reason: "429" }],
    });
    const { sleep, delays } = fastSleep();
    const engine = new DagWorkflowEngine(executor, makeGuardFactory(), undefined, {
      sleep,
      random: NO_JITTER,
    });
    await engine.run(def([stage("a", [], { maxRetries: 5 })]), BUDGET);
    expect(delays).toEqual([1000, 2000, 4000, 8000, 8000]);
  });

  it("tells the executor which attempt is the last", async () => {
    const seen: Array<{ attempt: number; maxAttempts: number } | undefined> = [];
    const executor: StageExecutor = {
      execute: async (_s, _b, attempt) => {
        seen.push(attempt);
        return { ok: true, value: { kind: "retryable", reason: "x" } };
      },
    };
    const engine = new DagWorkflowEngine(executor, makeGuardFactory(), undefined, {
      sleep: fastSleep().sleep,
    });
    await engine.run(def([stage("a", [], { maxRetries: 1 })]), BUDGET);
    expect(seen).toEqual([
      { attempt: 1, maxAttempts: 2 },
      { attempt: 2, maxAttempts: 2 },
    ]);
  });

  it("does not block dependents on a failed optional stage; run is degraded", async () => {
    const { executor, order } = recordingExecutor({
      a: [{ kind: "failed", reason: "boom" }],
    });
    const engine = new DagWorkflowEngine(executor, makeGuardFactory());
    const res = await engine.run(
      def([
        stage("a", [], { optional: true }),
        stage("b", [], { optional: true }),
        stage("c", ["a", "b"]),
      ]),
      BUDGET,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.status).toBe("degraded");
      const c = res.value.stages.find((s) => s.stageId === ("c" as StageId));
      expect(c?.status).toBe("completed");
    }
    expect(order).toContain("c");
  });

  it("still fails the run when a required stage fails", async () => {
    const { executor } = recordingExecutor({
      a: [{ kind: "failed", reason: "boom" }],
    });
    const engine = new DagWorkflowEngine(executor, makeGuardFactory());
    const res = await engine.run(
      def([stage("a"), stage("b", ["a"], { optional: true })]),
      BUDGET,
    );
    if (res.ok) expect(res.value.status).toBe("failed");
  });
});
