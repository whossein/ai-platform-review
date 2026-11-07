/**
 * Estimate handler — Token & cost estimation for a given diff.
 *
 * Accepts a diff string and returns:
 *  - Selected specialist agents
 *  - Estimated input/output tokens
 *  - Estimated cost (USD) based on active provider pricing
 *
 * This handler encapsulates the estimation logic shared between:
 *  - Root Express server (server.ts)
 *  - Standalone API server (apps/api/src/server.ts)
 */

import {
  plan,
  DEFAULT_RULES,
  DefaultRuleEngine,
  ruleLanguageFromEnv,
  MapRuleRegistry,
  ruleFindingToIssue,
  type FileRuleContext,
} from "@ai-review/orchestrator";
import { resolveDiffInput, parseDiffToFiles } from "@ai-review/git";
import type { AgentRegistry } from "@ai-review/core";
import { buildEffectiveEnv } from "./client-env.js";

export interface EstimateRequest {
  readonly diff: string;
  readonly env?: Record<string, string>;
  /** Specialist ids the project switched off; they are not counted (security reviewer always is). */
  readonly disabledAgents?: readonly string[];
  /** Whether the project has saved guidelines; the Contributing reviewer needs them. */
  readonly hasProjectInstructions?: boolean;
}

export interface EstimateResponse {
  agents: readonly string[];
  skipped: readonly string[];
  totalAgents: number;
  estimatedTokens: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  inputCostPer1M: number;
  outputCostPer1M: number;
  estimatedCostUsd: number;
  /** Model each selected agent is routed to (multi-provider setups only). */
  agentRouting?: Array<{
    agent: string;
    model: string;
    provider: string;
    tier: string;
  }>;
  deterministicIssues?: readonly any[];
}

export async function estimateHandler(
  request: EstimateRequest,
  agentRegistry: AgentRegistry
): Promise<EstimateResponse> {
  const { diff, env = {}, disabledAgents = [], hasProjectInstructions } = request;

  if (!diff || typeof diff !== "string" || diff.trim().length === 0) {
    throw new Error('field "diff" is required');
  }

  const mergedEnv = buildEffectiveEnv(process.env, env, { targetUrl: diff });
  const rawDiff = await resolveDiffInput(diff, mergedEnv);
  const files = parseDiffToFiles(rawDiff);

  // Run deterministic rules (pre-LLM)
  const deterministicIssues = [];
  if (files.length > 0) {
    const ruleRegistry = new MapRuleRegistry();
    for (const rule of DEFAULT_RULES) ruleRegistry.register(rule);
    const ruleEngine = new DefaultRuleEngine(ruleRegistry);
    const ruleCtx: FileRuleContext = {
      repositoryId: "repo.local",
      files: files,
      language: ruleLanguageFromEnv(mergedEnv),
    };
    const ruleRes = await ruleEngine.run(ruleCtx);

    if (ruleRes.ok) {
      for (const finding of ruleRes.value.findings) {
        deterministicIssues.push(ruleFindingToIssue(finding));
      }
    }
  }

  // Get available agents from the registry
  const agentsList = agentRegistry.list();
  const rawPlan = plan({
    diff: rawDiff,
    agents: agentsList,
    ...(hasProjectInstructions !== undefined ? { hasProjectInstructions } : {}),
  });
  // Same rule as the review: switched-off specialists never run, except the security reviewer.
  const off = new Set(disabledAgents.filter((id) => id !== "agent.security-reviewer"));
  const reviewPlan = {
    ...rawPlan,
    selected: rawPlan.selected.filter((a) => !off.has(a.id as string)),
    skipped: [
      ...rawPlan.skipped,
      ...rawPlan.selected
        .filter((a) => off.has(a.id as string))
        .map((agent) => ({ agent, reason: "switched off for this project" })),
    ],
  };

  const selectedAgents = reviewPlan.selected.map((s: any) => s.name);
  const skippedAgents = reviewPlan.skipped.map((s: any) => s.agent.name);
  const agentCount = reviewPlan.selected.length;

  // Estimate input tokens (diff characters / 4 + system/agent prompt overhead)
  const inputTokensPerAgent = Math.ceil(rawDiff.length / 4) + 600;
  const totalInputTokens = inputTokensPerAgent * agentCount;

  // Estimate output completion tokens per specialist agent
  const outputTokensPerAgent = 1000;
  const totalOutputTokens = outputTokensPerAgent * agentCount;

  // Resolve pricing based on active provider
  const { resolveProviderPreset } = await import("@ai-review/llm");
  const providerValue = env.AI_REVIEW_LLM_PROVIDER ?? "gemini";

  let inputCostPer1M = 0.15;
  let outputCostPer1M = 0.6;

  // Check if custom pricing configured in AI_PROVIDERS_JSON
  if (env.AI_PROVIDERS_JSON) {
    try {
      const providersData = JSON.parse(env.AI_PROVIDERS_JSON);
      const active =
        providersData.find(
          (p: any) => p.id === providerValue || p.provider === providerValue
        ) || providersData[0];

      if (active) {
        const preset = resolveProviderPreset(active.provider);
        if (typeof active.inputCostPer1M === "number") {
          inputCostPer1M = active.inputCostPer1M;
        } else if (preset?.defaultInputCostPer1M !== undefined) {
          inputCostPer1M = preset.defaultInputCostPer1M;
        }
        if (typeof active.outputCostPer1M === "number") {
          outputCostPer1M = active.outputCostPer1M;
        } else if (preset?.defaultOutputCostPer1M !== undefined) {
          outputCostPer1M = preset.defaultOutputCostPer1M;
        }
      }
    } catch {
      // ignore json parse error
    }
  } else {
    const preset = resolveProviderPreset(providerValue);
    if (preset?.defaultInputCostPer1M !== undefined)
      inputCostPer1M = preset.defaultInputCostPer1M;
    if (preset?.defaultOutputCostPer1M !== undefined)
      outputCostPer1M = preset.defaultOutputCostPer1M;
  }

  if (env.AI_REVIEW_INPUT_COST_PER_1M) {
    const parsed = parseFloat(env.AI_REVIEW_INPUT_COST_PER_1M);
    if (!isNaN(parsed)) inputCostPer1M = parsed;
  }
  if (env.AI_REVIEW_OUTPUT_COST_PER_1M) {
    const parsed = parseFloat(env.AI_REVIEW_OUTPUT_COST_PER_1M);
    if (!isNaN(parsed)) outputCostPer1M = parsed;
  }

  let estimatedCostUsd = 0;
  let agentRouting: EstimateResponse["agentRouting"];

  // With several providers each agent is priced at the model the router would
  // really pick for its tier, not at the active provider's rate.
  const { CheapestFirstRouter, providersFromEnv } = await import(
    "@ai-review/llm"
  );
  const providers = providersFromEnv(mergedEnv);
  if (providers.length >= 2 && agentCount > 0) {
    const router = new CheapestFirstRouter(providers, {
      defaultProvider: providers[0]?.id,
    });
    const budget = {
      tokenBudget: Number.MAX_SAFE_INTEGER,
      dollarBudget: Number.MAX_SAFE_INTEGER,
      executionBudgetMs: Number.MAX_SAFE_INTEGER,
    };
    const routing: NonNullable<EstimateResponse["agentRouting"]> = [];
    let inputRateSum = 0;
    let outputRateSum = 0;
    let routed = true;
    for (const agent of reviewPlan.selected) {
      const res = await router.select({
        requiredCapabilities: [],
        budget,
        ...(agent.preferredTier ? { preferredTier: agent.preferredTier } : {}),
        ...(agent.preferredModel
          ? { preferredModel: agent.preferredModel }
          : {}),
      });
      if (!res.ok) {
        routed = false;
        break;
      }
      const m = res.value;
      routing.push({
        agent: agent.name,
        model: m.id,
        provider: m.provider,
        tier: m.tier,
      });
      inputRateSum += m.inputCostPer1M;
      outputRateSum += m.outputCostPer1M;
      estimatedCostUsd +=
        (inputTokensPerAgent / 1000000) * m.inputCostPer1M +
        (outputTokensPerAgent / 1000000) * m.outputCostPer1M;
    }
    if (routed) {
      // Equal token counts per agent, so the token-weighted average is the mean.
      inputCostPer1M = inputRateSum / agentCount;
      outputCostPer1M = outputRateSum / agentCount;
      agentRouting = routing;
    } else {
      estimatedCostUsd = 0;
    }
  }

  if (!agentRouting && providerValue !== "mock" && providerValue !== "ollama") {
    const inputCost = (totalInputTokens / 1000000) * inputCostPer1M;
    const outputCost = (totalOutputTokens / 1000000) * outputCostPer1M;
    estimatedCostUsd = inputCost + outputCost;
  }

  return {
    agents: selectedAgents,
    skipped: skippedAgents,
    totalAgents: agentCount,
    estimatedTokens: totalInputTokens + totalOutputTokens,
    estimatedInputTokens: totalInputTokens,
    estimatedOutputTokens: totalOutputTokens,
    inputCostPer1M,
    outputCostPer1M,
    estimatedCostUsd: Number(estimatedCostUsd.toFixed(5)),
    ...(agentRouting ? { agentRouting } : {}),
    ...(deterministicIssues.length > 0 ? { deterministicIssues } : {}),
  };
}
