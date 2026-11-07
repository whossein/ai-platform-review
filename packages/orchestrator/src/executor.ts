/**
 * Review stage executor (ADR-0005).
 *
 * Implements StageExecutor for the workflow engine. Executes each review stage:
 * rules → specialist agents (via AgentRuntime ONLY) → critic → judge → reporting.
 */

import type {
  AgentRuntime,
  AdjudicatedIssue,
  AgentExecutionContext,
  AgentId,
  AsyncResult,
  BudgetGuard,
  ContextSlice,
  Issue,
  LLMClient,
  ReviewMetrics,
  ReviewId,
  RuleSuppression,
  WorkflowStage,
} from "@ai-review/core";

import type { StageExecutor, StageOutcome } from "@ai-review/workflow-engine";
import {
  DefaultRuleEngine,
  GOVERNANCE_RULES,
  mrMetadataFile,
  MapRuleRegistry,
  DEFAULT_RULES,
  ruleFindingToIssue,
  type FileRuleContext,
} from "@ai-review/config";
import { MarkdownReporter, JsonReporter } from "@ai-review/reporting";
import type { ReservableBudgetGuard } from "./budget.js";
import { isTransientError } from "./budget.js";
import { critique } from "./critic.js";
import { anchorIssues } from "./diff-anchor.js";

/**
 * Conservative fallback rate (USD per 1M tokens) for models absent from the
 * price table, so the dollar budget still counts their spend. Deliberately
 * above the $2/1M reservation estimate used in `runAgent`.
 */
export const FALLBACK_INPUT_COST_PER_1M = 5;
export const FALLBACK_OUTPUT_COST_PER_1M = 15;

export interface ModelPricing {
  readonly inputCostPer1M: number;
  readonly outputCostPer1M: number;
}

export interface ReviewExecutionContext {
  readonly diff: string;
  /** Enables MR metadata (branch/title) governance rules. */
  readonly governanceRules?: boolean | undefined;
  /** Language of deterministic rule messages (`fa`/`en`); English when omitted. */
  readonly language?: string | undefined;
  readonly files?: readonly { path: string; text: string }[] | undefined;
  readonly slice: ContextSlice;
  /** Rules a project manager silenced; matching deterministic findings are dropped. */
  readonly suppressedRules?: readonly RuleSuppression[] | undefined;
  readonly baseCtx: AgentExecutionContext;
  readonly runtime: AgentRuntime;
  readonly reservableGuard: ReservableBudgetGuard;
  readonly pricing: ReadonlyMap<string, ModelPricing>;
  readonly threshold: number;
  readonly maxAgentRetries?: number | undefined;
  readonly startedAt: number;
  /**
   * Run the first specialist's LLM call alone before releasing the others, so
   * the shared prompt prefix is already in the provider's prompt cache when
   * the parallel calls arrive. Costs one call of latency; only worth it when
   * several specialists share a prefix above the providers' cache minimum.
   */
  readonly cacheWarmup?: boolean | undefined;

  // Mutable accumulators populated across stages
  readonly deterministicIssues: Issue[];
  readonly allIssues: Issue[];
  readonly agentMetrics: Array<ReviewMetrics["agents"][number]>;
  readonly agentErrors: Array<{ agentId: string; message: string }>;
  consolidatedIssues: Issue[];
  adjudicatedIssues: AdjudicatedIssue[];
  markdownReport: string;
  jsonReport: string;
}

const SEVERITY_WEIGHT: Record<Issue["severity"], number> = {
  critical: 1.0,
  high: 0.8,
  medium: 0.5,
  low: 0.3,
  info: 0.1,
};

export function adjudicate(
  issues: readonly Issue[],
  threshold: number,
): AdjudicatedIssue[] {
  return issues.map((issue) => {
    const accepted = issue.confidence >= threshold;
    return {
      ...issue,
      accepted,
      adjudicationReason: accepted
        ? `confidence ${(issue.confidence * 100).toFixed(0)}% ≥ threshold`
        : `confidence ${(issue.confidence * 100).toFixed(0)}% below threshold`,
      rankScore: SEVERITY_WEIGHT[issue.severity] * issue.confidence,
    };
  });
}

export class ReviewStageExecutor implements StageExecutor {
  /** Settles once the first specialist call finishes (success or failure). */
  private warmup: Promise<void> | undefined;

  constructor(private readonly ctx: ReviewExecutionContext) {}

  async execute(
    stage: WorkflowStage,
    _budget: BudgetGuard,
    attempt?: { readonly attempt: number; readonly maxAttempts: number },
  ): AsyncResult<StageOutcome> {
    try {
      switch (stage.kind) {
        case "rules":
          return await this.executeRules();
        case "agent":
          return await this.executeAgent(stage, attempt);
        case "critic":
          return await this.executeCritic();
        case "judge":
          return await this.executeJudge();
        case "reporting":
          return await this.executeReporting();
        default:
          return { ok: true, value: { kind: "completed" } };
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      // A specialist that throws must still show up in `errors`; the retry and
      // permanent-failure paths of runAgent already record theirs before returning.
      if (stage.kind === "agent") {
        const agentId = (stage.agentId ?? stage.id) as AgentId;
        if (!this.ctx.agentErrors.some((e) => e.agentId === agentId)) {
          this.recordAgentFailure(agentId, reason, 0);
        }
      }
      return { ok: true, value: { kind: "failed", reason } };
    }
  }

  private async executeRules(): AsyncResult<StageOutcome> {
    const filesToScan: { path: string; text: string }[] = [];
    if (this.ctx.files && this.ctx.files.length > 0) {
      filesToScan.push(...this.ctx.files);
    } else if (
      this.ctx.slice &&
      this.ctx.slice.files &&
      this.ctx.slice.files.length > 0
    ) {
      for (const f of this.ctx.slice.files) {
        filesToScan.push({ path: f.path, text: this.ctx.slice.rendered ?? "" });
      }
    }

    const metadata = this.ctx.governanceRules
      ? mrMetadataFile(this.ctx.diff)
      : undefined;
    if (metadata) filesToScan.push(metadata);

    if (filesToScan.length > 0) {
      const ruleRegistry = new MapRuleRegistry();
      for (const rule of DEFAULT_RULES) ruleRegistry.register(rule);
      if (this.ctx.governanceRules) {
        for (const rule of GOVERNANCE_RULES) ruleRegistry.register(rule);
      }
      const ruleEngine = new DefaultRuleEngine(ruleRegistry);
      const ruleCtx: FileRuleContext = {
        repositoryId: "repo.local",
        files: filesToScan,
        projectInstructions: this.ctx.slice.projectInstructions,
        language: this.ctx.language,
      };
      const ruleRes = await ruleEngine.run(ruleCtx);
      if (ruleRes.ok) {
        const suppressed = this.ctx.suppressedRules ?? [];
        for (const finding of ruleRes.value.findings) {
          if (
            suppressed.some(
              (s) =>
                s.ruleId === finding.ruleId &&
                (!s.file || s.file === finding.location.file),
            )
          ) {
            continue;
          }
          const issue = ruleFindingToIssue(finding);
          this.ctx.deterministicIssues.push(issue);
          this.ctx.allIssues.push(issue);
        }
      }
    }
    return { ok: true, value: { kind: "completed" } };
  }

  /**
   * Post-run safety net: if the reporting stage never ran (an upstream stage
   * failed or the budget ran out), consolidate, adjudicate and render here so
   * the caller still gets a report built from whatever issues were collected.
   */
  async finalize(): Promise<void> {
    if (this.ctx.markdownReport) return;
    if (this.ctx.adjudicatedIssues.length === 0) {
      if (this.ctx.consolidatedIssues.length === 0) {
        this.ctx.consolidatedIssues = critique(this.ctx.allIssues);
      }
      this.ctx.adjudicatedIssues = adjudicate(
        this.ctx.consolidatedIssues,
        this.ctx.threshold,
      );
    }
    await this.executeReporting();
  }

  private async executeAgent(
    stage: WorkflowStage,
    attempt?: { readonly attempt: number; readonly maxAttempts: number },
  ): AsyncResult<StageOutcome> {
    if (!this.ctx.cacheWarmup) return this.runAgent(stage, attempt);
    // The check-and-set is synchronous, so exactly one parallel stage leads.
    if (this.warmup) {
      await this.warmup;
      return this.runAgent(stage, attempt);
    }
    let release!: () => void;
    this.warmup = new Promise<void>((resolve) => (release = resolve));
    try {
      return await this.runAgent(stage, attempt);
    } finally {
      release();
    }
  }

  private async runAgent(
    stage: WorkflowStage,
    attempt?: { readonly attempt: number; readonly maxAttempts: number },
  ): AsyncResult<StageOutcome> {
    const agentId = (stage.agentId ?? stage.id) as AgentId;

    // Estimate cost based on diff/slice size + expected completion
    const estimatedTokens = Math.max(
      1000,
      this.ctx.slice.estimatedTokens + 800,
    );
    const estimatedDollars = (estimatedTokens / 1_000_000) * 2.0; // conservative estimate

    // Pre-execution budget reservation
    const reservation = this.ctx.reservableGuard.reserve({
      tokens: estimatedTokens,
      dollars: estimatedDollars,
    });

    if (!reservation.ok) {
      // Budget cannot afford this agent; skip gracefully
      this.ctx.agentErrors.push({
        agentId,
        message: `Budget reservation denied: ${reservation.reason}`,
      });
      this.ctx.agentMetrics.push({
        agentId,
        executionMs: 0,
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
        cacheHits: 0,
        cacheMisses: 0,
      });
      return { ok: true, value: { kind: "completed" } };
    }

    const reservationId = reservation.reservationId;
    const agentStart = Date.now();

    // Agent execution context routed STRICTLY through AgentRuntime
    const agentLlm: LLMClient = {
      complete: (req) => this.ctx.baseCtx.llm.complete(req),
    };

    let execResult: Awaited<ReturnType<AgentRuntime["execute"]>>;
    try {
      execResult = await this.ctx.runtime.execute(agentId, {
        ...this.ctx.baseCtx,
        llm: agentLlm,
      });
    } catch (err) {
      // Do not leak the reservation; execute() records the failure.
      this.ctx.reservableGuard.release(reservationId);
      throw err;
    }

    const executionMs = Date.now() - agentStart;

    if (execResult.ok) {
      const value = execResult.value;
      const promptTokens = value.usage?.promptTokens ?? 0;
      const completionTokens = value.usage?.completionTokens ?? 0;
      const totalTokens = promptTokens + completionTokens;

      const price = value.model ? this.ctx.pricing.get(value.model) : undefined;
      const costEstimated = !price;
      const costUsd =
        (promptTokens / 1_000_000) *
          (price?.inputCostPer1M ?? FALLBACK_INPUT_COST_PER_1M) +
        (completionTokens / 1_000_000) *
          (price?.outputCostPer1M ?? FALLBACK_OUTPUT_COST_PER_1M);

      // Post-execution reconciliation
      this.ctx.reservableGuard.reconcile(reservationId, {
        tokensUsed: totalTokens,
        dollarsSpent: costUsd,
      });

      const prompt = this.ctx.slice.rendered;
      this.ctx.allIssues.push(
        ...anchorIssues(value.issues, this.ctx.diff, (path) => prompt.includes(path)),
      );
      this.ctx.agentMetrics.push({
        agentId,
        executionMs,
        promptTokens,
        completionTokens,
        costUsd,
        ...(costEstimated ? { costEstimated: true } : {}),
        cacheHits: 0,
        cacheMisses: 0,
      });

      return { ok: true, value: { kind: "completed" } };
    }

    // Release reservation on failure
    this.ctx.reservableGuard.release(reservationId);

    const error = execResult.error;
    const retryable = isTransientError(error);

    if (retryable) {
      const isLast = attempt !== undefined && attempt.attempt >= attempt.maxAttempts;
      if (!isLast) {
        return {
          ok: true,
          value: { kind: "retryable", reason: error.message },
        };
      }
      // Retries exhausted: surface the error like a permanent failure, but keep
      // the stage non-completed so the engine records it as degraded.
      this.recordAgentFailure(agentId, error.message, executionMs);
      return { ok: true, value: { kind: "retryable", reason: error.message } };
    }

    // Permanent agent failure: record error and complete stage gracefully so remaining review continues
    this.recordAgentFailure(agentId, error.message, executionMs);

    return { ok: true, value: { kind: "completed" } };
  }

  /** Records a failed specialist in `agentErrors` plus a zero-usage metrics row. */
  private recordAgentFailure(
    agentId: AgentId,
    message: string,
    executionMs: number,
  ): void {
    this.ctx.agentErrors.push({ agentId, message });
    this.ctx.agentMetrics.push({
      agentId,
      executionMs,
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      cacheHits: 0,
      cacheMisses: 0,
    });
  }

  private async executeCritic(): AsyncResult<StageOutcome> {
    this.ctx.consolidatedIssues = critique(this.ctx.allIssues);
    return { ok: true, value: { kind: "completed" } };
  }

  private async executeJudge(): AsyncResult<StageOutcome> {
    this.ctx.adjudicatedIssues = adjudicate(
      this.ctx.consolidatedIssues,
      this.ctx.threshold,
    );
    return { ok: true, value: { kind: "completed" } };
  }

  private async executeReporting(): AsyncResult<StageOutcome> {
    const accepted = this.ctx.adjudicatedIssues.filter((i) => i.accepted);
    const failureNote =
      this.ctx.agentErrors.length > 0
        ? ` (${this.ctx.agentErrors.length} agent(s) failed: ${this.ctx.agentErrors.map((e) => `${e.agentId} — ${e.message}`).join("; ")})`
        : "";
    const summary =
      accepted.length === 0
        ? `No issues met the publish threshold.${failureNote}`
        : `${accepted.length} issue(s) across ${new Set(accepted.map((i) => i.category)).size} categor(ies).${failureNote}`;

    const metrics: ReviewMetrics = {
      reviewId: this.ctx.baseCtx.reviewId as ReviewId,
      totalExecutionMs: Date.now() - this.ctx.startedAt,
      totalPromptTokens: this.ctx.agentMetrics.reduce(
        (sum, a) => sum + a.promptTokens,
        0,
      ),
      totalCompletionTokens: this.ctx.agentMetrics.reduce(
        (sum, a) => sum + a.completionTokens,
        0,
      ),
      totalCostUsd: this.ctx.agentMetrics.reduce(
        (sum, a) => sum + a.costUsd,
        0,
      ),
      ...(this.ctx.agentMetrics.some((a) => a.costEstimated)
        ? { hasUnpricedModels: true }
        : {}),
      cacheHits: 0,
      cacheMisses: 0,
      agents: this.ctx.agentMetrics,
    };

    const reportInput = {
      issues: this.ctx.adjudicatedIssues,
      metrics,
      summary,
    };

    const md = await new MarkdownReporter().render(reportInput);
    const json = await new JsonReporter().render(reportInput);

    this.ctx.markdownReport = md.ok
      ? md.value.content
      : "(failed to render markdown)";
    this.ctx.jsonReport = json.ok ? json.value.content : "{}";

    return { ok: true, value: { kind: "completed" } };
  }
}
