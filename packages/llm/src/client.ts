/**
 * Provider-agnostic LLM client + router (ADR-0007).
 *
 * `RoutingLLMClient` is the high-level handle agents use. It hides model
 * selection behind `ModelRouter` and never exposes providers/models to callers.
 * `CheapestFirstRouter` picks the lowest-cost model that satisfies the required
 * capabilities — the foundation of the "start cheap, escalate only if needed"
 * cost policy.
 */

import type {
  AsyncResult,
  LLMClient,
  LLMProvider,
  LLMRequest,
  LLMResponse,
  ModelDescriptor,
  ModelId,
  ModelRouter,
  PlatformError,
  ProviderId,
  Result,
  RoutingContext,
} from "@ai-review/core";
import {
  Semaphore,
  computeWaitMs,
  resolveMaxConcurrency,
} from "./rate-limit.js";

export interface RouterOptions {
  /**
   * The provider the user chose as default. It wins inside its own tier and
   * serves every call no model of the wanted tier can take. Without one, the
   * router falls back to the cheapest capable model.
   */
  readonly defaultProvider?: ProviderId | undefined;
}

/** Selects a capable model: by tier first, then the default provider, then cost. */
export class CheapestFirstRouter implements ModelRouter {
  constructor(
    private readonly providers: readonly LLMProvider[],
    private readonly options: RouterOptions = {},
  ) {}

  private allModels(): ModelDescriptor[] {
    return this.providers.flatMap((p) => [...p.models()]);
  }

  async select(ctx: RoutingContext): AsyncResult<ModelDescriptor> {
    const capable = this.allModels().filter((m) =>
      ctx.requiredCapabilities.every((c) => m.capabilities.includes(c)),
    );
    if (capable.length === 0) {
      return {
        ok: false,
        error: {
          category: "provider",
          code: "llm.no_capable_model",
          message: `no model satisfies capabilities: ${ctx.requiredCapabilities.join(", ")}`,
        },
      };
    }
    // Honor an affordable, capable preferred model when present.
    const preferred = capable.find((m) => m.id === ctx.preferredModel);
    if (preferred) return { ok: true, value: preferred };

    const fromDefault = capable.find(
      (m) => m.provider === this.options.defaultProvider,
    );

    if (ctx.preferredTier) {
      if (fromDefault?.tier === ctx.preferredTier) {
        return { ok: true, value: fromDefault };
      }
      const ofTier = capable.filter((m) => m.tier === ctx.preferredTier);
      if (ofTier.length > 0) {
        const cheapestOfTier = [...ofTier].sort(
          (a, b) =>
            a.inputCostPer1M +
            a.outputCostPer1M -
            (b.inputCostPer1M + b.outputCostPer1M),
        )[0]!;
        return { ok: true, value: cheapestOfTier };
      }
    }

    // A free local model must not silently take over from the user's choice.
    if (fromDefault) return { ok: true, value: fromDefault };

    // Otherwise cheapest by combined per-1M cost (local/mock = 0 wins).
    const cheapest = [...capable].sort(
      (a, b) =>
        a.inputCostPer1M +
        a.outputCostPer1M -
        (b.inputCostPer1M + b.outputCostPer1M),
    )[0]!;
    return { ok: true, value: cheapest };
  }
}

/**
 * Whether another provider could serve a request this one failed. A 400/422
 * means the request itself was rejected, so resending it only burns time.
 */
function canFailOver(error: PlatformError): boolean {
  if (error.category !== "provider") return false;
  const status = error.details?.["status"];
  return status !== 400 && status !== 422;
}

/** Tuning for rate-limit handling and per-provider concurrency. */
export interface RoutingClientOptions {
  /** Max in-flight requests per provider. Default: env or 4. */
  readonly maxConcurrency?: number;
  /** Passes over the provider list for one call (1 = never wait). Default 4. */
  readonly maxAttempts?: number;
  /** Cap for a single rate-limit wait. Default 60s. */
  readonly maxWaitMs?: number;
  /** Cap for all waits of one call together. Default 150s. */
  readonly maxTotalWaitMs?: number;
  /** Backoff base when the provider sends no hint. Default 2s. */
  readonly baseBackoffMs?: number;
  /** Injected for tests; defaults to `setTimeout`. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Jitter source in [0, 1). Defaults to `Math.random`. */
  readonly random?: () => number;
  /** Defaults to `console.warn`. */
  readonly warn?: (message: string) => void;
}

const isRateLimited = (e: PlatformError) =>
  e.category === "provider" &&
  e.details?.["status"] === 429 &&
  e.details?.["quotaExhausted"] !== true;

export class RoutingLLMClient implements LLMClient {
  private readonly gates = new Map<string, Semaphore>();
  private readonly maxConcurrency: number;
  private readonly maxAttempts: number;
  private readonly maxWaitMs: number;
  private readonly maxTotalWaitMs: number;
  private readonly baseBackoffMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly warn: (message: string) => void;

  constructor(
    private readonly providers: readonly LLMProvider[],
    private readonly router: ModelRouter,
    private readonly defaultContext: Omit<RoutingContext, "preferredModel">,
    options: RoutingClientOptions = {},
  ) {
    this.maxConcurrency = Math.max(
      1,
      options.maxConcurrency ?? resolveMaxConcurrency(),
    );
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 4);
    this.maxWaitMs = options.maxWaitMs ?? 60_000;
    this.maxTotalWaitMs = options.maxTotalWaitMs ?? 150_000;
    this.baseBackoffMs = options.baseBackoffMs ?? 2_000;
    this.sleep =
      options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = options.random ?? Math.random;
    this.warn = options.warn ?? ((m) => console.warn(m));
  }

  /** Runs one provider call inside that provider's concurrency gate. */
  private gated<T>(providerId: string, task: () => Promise<T>): Promise<T> {
    let gate = this.gates.get(providerId);
    if (!gate) {
      gate = new Semaphore(this.maxConcurrency);
      this.gates.set(providerId, gate);
    }
    return gate.run(task);
  }

  /**
   * Providers to try for `modelId`, best first: those serving the same model,
   * then the same tier, then the rest. Provider order breaks ties, so the
   * default provider leads. An explicitly requested model never changes.
   */
  private attemptsFor(
    modelId: ModelId,
    pinned: boolean,
  ): Array<{ provider: LLMProvider; model: ModelId }> {
    const all = this.providers.flatMap((provider) =>
      provider.models().map((m) => ({ provider, descriptor: m })),
    );
    const tier = all.find((a) => a.descriptor.id === modelId)?.descriptor.tier;
    const rank = (d: ModelDescriptor) =>
      d.id === modelId ? 0 : d.tier === tier ? 1 : 2;
    const required = this.defaultContext.requiredCapabilities;
    return all
      .filter((a) => required.every((c) => a.descriptor.capabilities.includes(c)))
      .filter((a) => !pinned || a.descriptor.id === modelId)
      .sort((a, b) => rank(a.descriptor) - rank(b.descriptor))
      .map((a) => ({ provider: a.provider, model: a.descriptor.id }));
  }

  async complete(
    request: Omit<LLMRequest, "model"> & { model?: ModelId },
  ): AsyncResult<LLMResponse> {
    const pinned = Boolean(request.model);
    let modelId = request.model;
    if (!modelId) {
      const selected = await this.router.select({
        ...this.defaultContext,
        ...(request.model ? { preferredModel: request.model } : {}),
        ...(request.preferredTier
          ? { preferredTier: request.preferredTier }
          : {}),
      });
      if (!selected.ok) return selected;
      modelId = selected.value.id;
    }

    const attempts = this.attemptsFor(modelId, pinned);
    if (!attempts.some((a) => a.model === modelId)) {
      const error: PlatformError = {
        category: "provider",
        code: "llm.unknown_model",
        message: `no provider serves model "${modelId}"`,
      };
      return { ok: false, error };
    }

    // The caller sees the first failure: it names the provider the user expects.
    //
    // Rate limits are handled here and only here (providers make one HTTP call
    // per attempt). A 429 fails over to the next provider at once; only when a
    // whole pass over the providers ends with a 429 do we wait (the soonest
    // hint, capped, with jitter) and pass again, up to `maxAttempts` passes.
    // The semaphore slot is released while waiting.
    let firstFailure: Result<LLMResponse> | undefined;
    let totalWaitMs = 0;
    for (let pass = 1; ; pass++) {
      const limited: Array<{ id: string; hintMs: number | undefined }> = [];
      let otherFailures = 0;
      for (let i = 0; i < attempts.length; i++) {
        const { provider, model } = attempts[i]!;
        const result = await this.gated(provider.id, () =>
          provider.complete({ ...request, model }),
        );
        if (result.ok) return result;
        firstFailure ??= result;
        if (!canFailOver(result.error)) return firstFailure;
        if (isRateLimited(result.error)) {
          const hint = result.error.details?.["retryAfterMs"];
          limited.push({
            id: provider.id,
            hintMs: typeof hint === "number" ? hint : undefined,
          });
        } else {
          otherFailures++;
        }
        if (!isRateLimited(result.error) && i < attempts.length - 1) {
          // Code and status only: provider messages can embed the request URL.
          const status = result.error.details?.["status"];
          this.warn(
            `[llm] ${provider.id} failed (${result.error.code}${
              status ? ` ${status}` : ""
            }), trying the next provider`,
          );
        }
      }

      // Wait only when the pass failed purely on rate limits. With a mixed
      // failure (e.g. one 429, one 500) failover has already run its course.
      if (limited.length === 0 || otherFailures > 0) return firstFailure!;
      const hints = limited.flatMap((l) => (l.hintMs === undefined ? [] : [l.hintMs]));
      const waitMs = computeWaitMs(
        hints.length > 0 ? Math.min(...hints) : undefined,
        pass,
        {
          maxWaitMs: this.maxWaitMs,
          baseBackoffMs: this.baseBackoffMs,
          random: this.random,
        },
      );
      if (pass >= this.maxAttempts || totalWaitMs + waitMs > this.maxTotalWaitMs) {
        // Out of patience: surface the failure, and tell the executor not to
        // stack its own retries on top (they would multiply the HTTP calls).
        const first = firstFailure!;
        return first.ok
          ? first
          : { ok: false, error: { ...first.error, retryable: false } };
      }
      this.warn(
        `[llm] rate limited (HTTP 429) by ${[...new Set(limited.map((l) => l.id))].join(", ")}; waiting ${(waitMs / 1000).toFixed(1)}s before attempt ${pass + 1}/${this.maxAttempts}`,
      );
      totalWaitMs += waitMs;
      await this.sleep(waitMs);
    }
  }
}
