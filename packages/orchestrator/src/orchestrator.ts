/**
 * Review orchestrator (composition root).
 *
 * Integrates the full review lifecycle via DagWorkflowEngine:
 *   diff → shared context slice (built once) → deterministic rules →
 *   smart routing → specialist agents (executed STRICTLY via AgentRuntime in parallel) →
 *   Critic (consolidation) → Judge (adjudication) → Markdown/JSON reporting.
 */

import type {
  AdjudicatedIssue,
  AgentExecutionContext,
  AgentId,
  Budget,
  ContextSlice,
  LLMClient,
  MemoryHandle,
  ReviewMetrics,
  ReviewId,
  StageId,
  WorkflowDefinition,
  WorkflowStage,
  AgentRegistry,
  AgentRuntime,
  ContextEngine,
  MemoryStore,
  WorkflowEngine,
  BudgetGuard,
} from "@ai-review/core";
import type { StageExecutor } from "@ai-review/workflow-engine";
import type { SourceFile } from "@ai-review/context-engine";
import type {} from "@ai-review/core";

import { plan, type ReviewPlan } from "./planner.js";
import { ReservableBudgetGuard } from "./budget.js";
import {
  ReviewStageExecutor,
  type ReviewExecutionContext,
  type ModelPricing,
  adjudicate,
} from "./executor.js";

export interface ReviewResult {
  readonly markdown: string;
  readonly json: string;
  readonly accepted: number;
  readonly total: number;
  readonly metrics: ReviewMetrics;
  /** All adjudicated issues (accepted + rejected), ranked — for publishing. */
  readonly issues: readonly AdjudicatedIssue[];
  /**
   * Specialists that failed to produce a result (LLM error, bad JSON, budget
   * exhaustion, …). Never silently swallowed — callers should surface these,
   * since they are the most common reason a review reports zero issues.
   */
  readonly errors: readonly {
    readonly agentId: string;
    readonly message: string;
  }[];
}

export interface OrchestratorContext {
  readonly contextEngine: ContextEngine;
  readonly llm: LLMClient;
  readonly pricing: ReadonlyMap<string, ModelPricing>;
  readonly memoryStore: MemoryStore;
  readonly registry: AgentRegistry;
  readonly runtime: AgentRuntime;
  readonly createWorkflowEngine: (
    executor: StageExecutor,
    makeBudgetGuard: (b: Budget) => BudgetGuard,
  ) => WorkflowEngine;
}

export interface RunOptions {
  readonly diff: string;
  readonly reviewId?: string;
  readonly confidenceThreshold?: number;
  readonly budget?: Budget;
  /** Optional full file texts (e.g. from a local folder) for richer context. */
  readonly files?: readonly SourceFile[];
  /** Optional env overrides for the LLM provider. */
  readonly env?: Record<string, string>;
  /** Optional explicit list of specialist names to run. If provided, overrides the planner. */
  readonly selectedSpecialists?: readonly string[];
  /** Optional max retries per agent stage on transient errors (default: 2). */
  readonly maxRetries?: number;
  /** Optional custom or persistent memory store. */
  readonly memoryStore?: MemoryStore;
  /** Optional project-specific custom instructions/guidelines for AI reviewers. */
  readonly customInstructions?: string;
  /** Optional project name for branding guidelines. */
  readonly projectName?: string;
  /** Optional structural context (e.g. from the project index) appended to every reviewer's input. */
  readonly projectContext?: string;
}

export class ReviewOrchestrator {
  constructor(private readonly ctx: OrchestratorContext) {}

  async review(opts: RunOptions): Promise<ReviewResult> {
    const reviewId = (opts.reviewId ?? "review.local") as ReviewId;
    const threshold = opts.confidenceThreshold ?? 0.6;

    const envExecutionBudgetMs = opts.env?.AI_REVIEW_EXECUTION_BUDGET_MS
      ? parseInt(opts.env.AI_REVIEW_EXECUTION_BUDGET_MS, 10)
      : undefined;
    const envDollarBudget = opts.env?.AI_REVIEW_DOLLAR_BUDGET
      ? parseFloat(opts.env.AI_REVIEW_DOLLAR_BUDGET)
      : undefined;
    const envTokenBudget = opts.env?.AI_REVIEW_TOKEN_BUDGET
      ? parseInt(opts.env.AI_REVIEW_TOKEN_BUDGET, 10)
      : undefined;

    const budget: Budget = opts.budget ?? {
      tokenBudget: envTokenBudget ?? 2_000_000,
      dollarBudget: envDollarBudget ?? 25,
      executionBudgetMs: envExecutionBudgetMs ?? 600_000, // 10 minutes total execution allowance
    };
    const maxRetries = opts.maxRetries ?? 2;
    const started = Date.now();

    const llm = this.ctx.llm;
    const contextEngine = this.ctx.contextEngine;
    const built = await contextEngine.build({
      repositoryId: "repo.local" as never,
      diff: opts.diff,
      ...(opts.files ? { files: opts.files } : {}),
    });
    let slice: ContextSlice;
    const projectInstructions = opts.customInstructions?.trim() || undefined;

    const structureSection = opts.projectContext?.trim()
      ? `\n\n${opts.projectContext.trim()}\n`
      : "";

    const instructionFields = {
      ...(projectInstructions ? { projectInstructions } : {}),
      ...(opts.projectName ? { projectName: opts.projectName } : {}),
    };

    if (built.ok) {
      const sliceRes = await contextEngine.slice({
        handle: built.value.handle,
        tokenBudget: budget.tokenBudget,
      });
      const structural = sliceRes.ok ? sliceRes.value.rendered : "";
      const rendered = `${opts.diff}${structureSection}\n\n--- context ---\n${structural}`;
      slice = {
        handle: built.value.handle,
        version: built.value.version,
        files: sliceRes.ok ? sliceRes.value.files : [],
        rendered,
        estimatedTokens: Math.ceil(rendered.length / 4),
        compressed: sliceRes.ok ? sliceRes.value.compressed : false,
        ...instructionFields,
      };
    } else {
      const rendered = `${opts.diff}${structureSection}`;
      slice = {
        handle: "ctx.local" as ContextSlice["handle"],
        version: 1,
        files: [],
        rendered,
        estimatedTokens: Math.ceil(rendered.length / 4),
        compressed: false,
        ...instructionFields,
      };
    }

    // Reservable budget guard: enforces atomic pre-execution reservations
    const reservableGuard = new ReservableBudgetGuard(budget);

    // Scoped memory
    const memoryStore = this.ctx.memoryStore;
    const memory: MemoryHandle = {
      scope: "review",
      get: (key) => memoryStore.get("review", key),
      set: (key, value) => memoryStore.set("review", key, value),
      delete: (key) => memoryStore.delete("review", key),
    };
    const registry = this.ctx.registry;
    const runtime = this.ctx.runtime;
    const pricing = this.ctx.pricing;
    // Base execution context passed into agents through AgentRuntime
    const baseCtx: AgentExecutionContext = {
      reviewId,
      context: {
        slice: async () => ({ ok: true, value: slice }),
      },
      tools: {
        invoke: async () => ({ ok: true, value: { output: {} } }),
        available: () => [],
      },
      skills: {
        execute: async () => ({ ok: true, value: { result: {} } }),
        available: () => [],
      },
      memory,
      llm,
      budget: reservableGuard,
      seedSlice: slice,
    };

    // Plan smart routing for specialists
    const availableAgents = registry.list();
    const reviewPlan: ReviewPlan = plan({
      diff: opts.diff,
      agents: availableAgents,
    });

    const agentsToRun = opts.selectedSpecialists
      ? availableAgents.filter((s) => opts.selectedSpecialists?.includes(s.name))
      : reviewPlan.selected;

    // Construct ReviewExecutionContext
    const reviewCtx: ReviewExecutionContext = {
      diff: opts.diff,
      governanceRules: opts.env?.AI_REVIEW_GOVERNANCE_RULES === "1",
      files: opts.files,
      slice,
      baseCtx,
      runtime,
      reservableGuard,
      pricing,
      threshold,
      maxAgentRetries: maxRetries,
      startedAt: started,
      deterministicIssues: [],
      allIssues: [],
      agentMetrics: [],
      agentErrors: [],
      consolidatedIssues: [],
      adjudicatedIssues: [],
      markdownReport: "",
      jsonReport: "",
    };

    const executor = new ReviewStageExecutor(reviewCtx);

    // Build DAG Stages for the WorkflowEngine
    const stages: WorkflowStage[] = [];

    // Stage 1: Deterministic Rules
    const rulesStageId = "stage.rules" as StageId;
    stages.push({
      id: rulesStageId,
      kind: "rules",
      dependsOn: [],
    });

    // Stage 2: Specialist Agent Stages (run in parallel)
    const agentStageIds: StageId[] = [];
    for (const agent of agentsToRun) {
      const stageId = `agent.${agent.id}` as StageId;
      agentStageIds.push(stageId);
      stages.push({
        id: stageId,
        kind: "agent",
        agentId: agent.id as AgentId,
        dependsOn: [rulesStageId],
        parallelGroup: "specialists",
        maxRetries,
      });
    }

    // Stage 3: Critic (consolidation) - depends on rules and all specialists
    const criticStageId = "stage.critic" as StageId;
    stages.push({
      id: criticStageId,
      kind: "critic",
      dependsOn: [rulesStageId, ...agentStageIds],
    });

    // Stage 4: Judge (adjudication)
    const judgeStageId = "stage.judge" as StageId;
    stages.push({
      id: judgeStageId,
      kind: "judge",
      dependsOn: [criticStageId],
    });

    // Stage 5: Reporting (render output)
    const reportingStageId = "stage.reporting" as StageId;
    stages.push({
      id: reportingStageId,
      kind: "reporting",
      dependsOn: [judgeStageId],
    });

    const workflowDefinition: WorkflowDefinition = {
      id: `wf.review.${reviewId}` as never,
      name: "Standard Code Review",
      description: "Declarative DAG orchestration of review stages",
      stages,
    };

    // Run the review via DagWorkflowEngine
    const engine = this.ctx.createWorkflowEngine(
      executor,
      () => reservableGuard,
    );
    await engine.run(workflowDefinition, budget);

    // If reporting stage did not populate reports (e.g. total failure), ensure fallback reports
    if (!reviewCtx.adjudicatedIssues.length && reviewCtx.allIssues.length) {
      reviewCtx.adjudicatedIssues = adjudicate(reviewCtx.allIssues, threshold);
    }

    const accepted = reviewCtx.adjudicatedIssues.filter((i) => i.accepted);

    const metrics: ReviewMetrics = {
      reviewId,
      totalExecutionMs: Date.now() - started,
      totalPromptTokens: reviewCtx.agentMetrics.reduce(
        (sum, a) => sum + a.promptTokens,
        0,
      ),
      totalCompletionTokens: reviewCtx.agentMetrics.reduce(
        (sum, a) => sum + a.completionTokens,
        0,
      ),
      totalCostUsd: reviewCtx.agentMetrics.reduce(
        (sum, a) => sum + a.costUsd,
        0,
      ),
      cacheHits: 0, // Cache stats moved out of orchestrator
      cacheMisses: 0, // Cache stats moved out of orchestrator
      agents: reviewCtx.agentMetrics,
    };

    return {
      markdown: reviewCtx.markdownReport || "(no report generated)",
      json: reviewCtx.jsonReport || "{}",
      accepted: accepted.length,
      total: reviewCtx.adjudicatedIssues.length,
      metrics,
      issues: reviewCtx.adjudicatedIssues,
      errors: reviewCtx.agentErrors,
    };
  }
}

export { makeBudgetGuard } from "./budget.js";
export { adjudicate } from "./executor.js";
