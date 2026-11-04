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

export class RoutingLLMClient implements LLMClient {
  constructor(
    private readonly providers: readonly LLMProvider[],
    private readonly router: ModelRouter,
    private readonly defaultContext: Omit<RoutingContext, "preferredModel">,
  ) {}

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
    let firstFailure: Result<LLMResponse> | undefined;
    for (const { provider, model } of attempts) {
      const result = await provider.complete({ ...request, model });
      if (result.ok) return result;
      firstFailure ??= result;
      if (!canFailOver(result.error)) break;
      // Code and status only: provider messages can embed the request URL.
      console.warn(
        `[llm] ${provider.id} failed (${result.error.code}${
          result.error.details?.["status"]
            ? ` ${result.error.details["status"]}`
            : ""
        }), trying the next provider`,
      );
    }
    return firstFailure!;
  }
}
