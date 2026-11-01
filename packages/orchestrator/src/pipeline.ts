import type { LLMProvider, Budget, BudgetGuard, AgentRegistry } from "@ai-review/core";
import { DefaultContextEngine } from "@ai-review/context-engine";
import {
  providersFromEnv,
  CheapestFirstRouter,
  RoutingLLMClient,
  CachingLLMClient,
} from "@ai-review/llm";
import { DefaultAgentRuntime, MapAgentRegistry } from "@ai-review/agent-runtime";
import { createDefaultToolRegistry } from "@ai-review/tools";
import { createDefaultSkillRegistry } from "@ai-review/skills";
import {
  InMemoryCache,
  SPECIALISTS,
  makeSpecialistDefinition,
  makeSpecialistHandler,
} from "@ai-review/shared";
import { PersistentMemoryStore } from "@ai-review/memory";
import { DagWorkflowEngine, type StageExecutor } from "@ai-review/workflow-engine";
import {
  ReviewOrchestrator,
  type OrchestratorContext,
  type RunOptions,
  type ReviewResult,
} from "./orchestrator.js";

const llmCache = new InMemoryCache<any>("llm_response");

function isAgentRegistry(val: unknown): val is AgentRegistry {
  return (
    typeof val === "object" &&
    val !== null &&
    typeof (val as any).register === "function" &&
    typeof (val as any).list === "function"
  );
}

function createDefaultRegistry(env?: Record<string, string>): AgentRegistry {
  const reg = new MapAgentRegistry();
  for (const spec of SPECIALISTS) {
    reg.register({
      definition: makeSpecialistDefinition(spec, env),
      handler: makeSpecialistHandler(spec, env),
    });
  }
  return reg;
}

/**
 * Canonical review pipeline factory and executor.
 *
 * Configures and runs the full multi-agent review pipeline:
 * Context Engine → Agent Registry → Routing LLM Client (with cache) →
 * DAG Workflow Engine → Review Orchestrator.
 *
 * Supports both DI-style (explicit pre-populated registry) and standalone invocation.
 *
 * @param registryOrOpts - Either a pre-populated AgentRegistry or RunOptions
 * @param optsOrProviders - RunOptions (if registry passed first) or extra providers
 * @param maybeExtraProviders - Optional additional LLM providers
 */
export async function runReview(
  registry: AgentRegistry,
  opts: RunOptions,
  extraProviders?: readonly LLMProvider[]
): Promise<ReviewResult>;
export async function runReview(
  opts: RunOptions,
  extraProviders?: readonly LLMProvider[]
): Promise<ReviewResult>;
export async function runReview(
  registryOrOpts: AgentRegistry | RunOptions,
  optsOrProviders?: RunOptions | readonly LLMProvider[],
  maybeExtraProviders?: readonly LLMProvider[]
): Promise<ReviewResult> {
  let registry: AgentRegistry;
  let opts: RunOptions;
  let extraProviders: readonly LLMProvider[] | undefined;

  if (isAgentRegistry(registryOrOpts)) {
    registry = registryOrOpts;
    opts = optsOrProviders as RunOptions;
    extraProviders = maybeExtraProviders;
  } else {
    opts = registryOrOpts;
    extraProviders = optsOrProviders as readonly LLMProvider[] | undefined;
    registry = createDefaultRegistry(opts.env);
  }

  const contextEngine = new DefaultContextEngine();
  const envProviders = [
    ...(extraProviders ?? []),
    ...providersFromEnv(opts.env ?? {}),
  ];
  const router = new CheapestFirstRouter(envProviders);
  const routingCtx = {
    requiredCapabilities: [],
    budget: opts.budget ?? {
      tokenBudget: 1000000,
      dollarBudget: 100,
      executionBudgetMs: 100000,
    },
  };
  const llm = new CachingLLMClient(
    new RoutingLLMClient(envProviders, router, routingCtx),
    llmCache,
  );
  const memoryStore = opts.memoryStore ?? new PersistentMemoryStore("./.data/memory");
  const toolRegistry = createDefaultToolRegistry(process.cwd());
  const skillRegistry = createDefaultSkillRegistry();
  const runtime = new DefaultAgentRuntime(registry, toolRegistry, skillRegistry);
  // Price table from the configured providers' model descriptors, so dollar
  // budgets and reported costs reflect real per-model rates.
  const pricing = new Map<string, { inputCostPer1M: number; outputCostPer1M: number }>();
  for (const provider of envProviders) {
    for (const m of provider.models()) {
      pricing.set(m.id, {
        inputCostPer1M: m.inputCostPer1M,
        outputCostPer1M: m.outputCostPer1M,
      });
    }
  }

  const ctx: OrchestratorContext = {
    contextEngine,
    llm,
    memoryStore,
    registry,
    runtime,
    pricing,
    createWorkflowEngine: (
      executor: StageExecutor,
      makeBudgetGuard: (b: Budget) => BudgetGuard,
    ) => new DagWorkflowEngine(executor, makeBudgetGuard as any),
  };
  const orchestrator = new ReviewOrchestrator(ctx);
  const result = await orchestrator.review(opts);
  return {
    ...result,
    metrics: { ...result.metrics, cacheHits: llm.hits, cacheMisses: llm.misses },
  };
}
