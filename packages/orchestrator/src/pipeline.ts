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

// Shared across reviews, so it must be bounded (LRU + TTL).
const llmCache = new InMemoryCache<any>("llm_response", {
  maxEntries: 500,
  defaultTtlMs: 60 * 60 * 1000,
});

/**
 * Cache namespace identifying what actually serves routed LLM calls: each
 * provider's id and models (id + tier), plus any base URLs from the env
 * (providers do not expose theirs). API keys are never included.
 */
function llmCacheNamespace(
  providers: readonly LLMProvider[],
  env: Record<string, string | undefined>,
): string {
  const parts = providers.map(
    (p) =>
      `${p.id}[${p.models()
        .map((m) => `${m.id}:${m.tier}`)
        .join(",")}]`,
  );
  const urls: string[] = [];
  for (const [k, v] of Object.entries(env)) {
    if (v && /BASE_?URL/i.test(k)) urls.push(`${k}=${v}`);
  }
  if (env["AI_PROVIDERS_JSON"]) {
    try {
      const data = JSON.parse(env["AI_PROVIDERS_JSON"]);
      if (Array.isArray(data)) {
        for (const d of data) {
          if (d && typeof d.baseUrl === "string") urls.push(d.baseUrl);
        }
      }
    } catch {
      /* unparsable config yields no providers anyway */
    }
  }
  return [...parts, ...urls.sort()].join("|");
}

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
  const routing = new RoutingLLMClient(envProviders, router, routingCtx);
  const cacheDisabled = opts.env?.["AI_REVIEW_LLM_CACHE"] === "0";
  const cachingLlm = cacheDisabled
    ? undefined
    : new CachingLLMClient(
        routing,
        llmCache,
        llmCacheNamespace(envProviders, opts.env ?? {}),
      );
  const llm = cachingLlm ?? routing;
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
    metrics: {
      ...result.metrics,
      cacheHits: cachingLlm?.hits ?? 0,
      cacheMisses: cachingLlm?.misses ?? 0,
    },
  };
}
