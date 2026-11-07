/**
 * LLM layer tests.
 *
 * Prove the provider-agnostic contract (ADR-0007): the cheapest capable model is
 * selected, unknown-capability requests fail cleanly, and the mock provider
 * returns structured JSON findings from a diff without spending tokens.
 */

import { describe, it, expect } from "vitest";
import type {
  Budget,
  LLMProvider,
  ModelDescriptor,
  ModelId,
  PlatformError,
  ProviderId,
} from "@ai-review/core";
import {
  MockLLMProvider,
  CheapestFirstRouter,
  RoutingLLMClient,
  providersFromEnv,
} from "./index.js";

const BUDGET: Budget = {
  tokenBudget: 1000,
  dollarBudget: 1,
  executionBudgetMs: 60000,
};

/** A fake premium provider so routing has something more expensive to reject. */
class PremiumProvider implements LLMProvider {
  readonly id = "provider.premium" as ProviderId;
  models(): readonly ModelDescriptor[] {
    return [
      {
        id: "premium.model" as ModelId,
        provider: this.id,
        tier: "premium",
        capabilities: ["text", "json_mode"],
        contextWindow: 200_000,
        inputCostPer1M: 15,
        outputCostPer1M: 75,
      },
    ];
  }
  async complete() {
    return {
      ok: true as const,
      value: {
        model: "premium.model" as ModelId,
        content: "{}",
        usage: { promptTokens: 1, completionTokens: 1 },
        finishReason: "stop" as const,
      },
    };
  }
}

describe("CheapestFirstRouter", () => {
  it("selects the cheapest capable model (mock/local wins over premium)", async () => {
    const router = new CheapestFirstRouter([
      new MockLLMProvider(),
      new PremiumProvider(),
    ]);
    const res = await router.select({
      requiredCapabilities: ["text", "json_mode"],
      budget: BUDGET,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.tier).toBe("local");
  });

  it("fails when no model satisfies the required capabilities", async () => {
    const router = new CheapestFirstRouter([new MockLLMProvider()]);
    const res = await router.select({
      requiredCapabilities: ["vision"],
      budget: BUDGET,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("llm.no_capable_model");
  });
});

/** A provider that records its calls and fails with `failWith` when set. */
function fakeProvider(
  id: string,
  model: string,
  tier: ModelDescriptor["tier"],
  cost: number,
  failWith?: PlatformError,
) {
  const calls: string[] = [];
  const provider: LLMProvider = {
    id: id as ProviderId,
    models: () => [
      {
        id: model as ModelId,
        provider: id as ProviderId,
        tier,
        capabilities: ["text"],
        contextWindow: 1000,
        inputCostPer1M: cost,
        outputCostPer1M: cost,
      },
    ],
    complete: async (req) => {
      calls.push(req.model);
      if (failWith) return { ok: false, error: failWith };
      return {
        ok: true,
        value: {
          model: req.model,
          content: "{}",
          usage: { promptTokens: 1, completionTokens: 1 },
          finishReason: "stop",
        },
      };
    },
  };
  return { provider, calls };
}

function clientFor(providers: LLMProvider[]) {
  return new RoutingLLMClient(
    providers,
    new CheapestFirstRouter(providers, { defaultProvider: providers[0]?.id }),
    { requiredCapabilities: [], budget: BUDGET },
  );
}

const HTTP = (status: number): PlatformError => ({
  category: "provider",
  code: "llm.http_error",
  message: `HTTP ${status}`,
  details: { status },
});

describe("routing with several providers", () => {
  it("keeps the default provider when a cheaper one shares its tier", async () => {
    const active = fakeProvider("active", "pricey", "cheap", 5);
    const other = fakeProvider("other", "cheaper", "cheap", 1);
    const res = await clientFor([active.provider, other.provider]).complete({
      messages: [],
      preferredTier: "cheap",
    });
    expect(res.ok && res.value.model).toBe("pricey");
  });

  it("does not hand a missing tier to a free local model", async () => {
    const active = fakeProvider("active", "cloud", "cheap", 1);
    const local = fakeProvider("local", "free", "cheap", 0);
    const res = await clientFor([active.provider, local.provider]).complete({
      messages: [],
      preferredTier: "premium",
    });
    expect(res.ok && res.value.model).toBe("cloud");
    expect(local.calls).toEqual([]);
  });

  it("sends each tier to its own model", async () => {
    const cheap = fakeProvider("a", "m-cheap", "cheap", 1);
    const mid = fakeProvider("b", "m-mid", "mid", 3);
    const premium = fakeProvider("c", "m-premium", "premium", 5);
    const client = clientFor([cheap.provider, mid.provider, premium.provider]);
    for (const [tier, model] of [
      ["cheap", "m-cheap"],
      ["mid", "m-mid"],
      ["premium", "m-premium"],
    ] as const) {
      const res = await client.complete({ messages: [], preferredTier: tier });
      expect(res.ok && res.value.model).toBe(model);
    }
  });

  it("uses the earlier provider for a model two providers serve", async () => {
    const first = fakeProvider("first", "same", "cheap", 1);
    const second = fakeProvider("second", "same", "cheap", 1);
    await clientFor([first.provider, second.provider]).complete({
      messages: [],
    });
    expect(first.calls).toEqual(["same"]);
    expect(second.calls).toEqual([]);
  });
});

describe("failover", () => {
  it("moves to the next provider on a 429 and reports the model that answered", async () => {
    const down = fakeProvider("down", "m1", "cheap", 1, HTTP(429));
    const up = fakeProvider("up", "m2", "cheap", 2);
    const res = await clientFor([down.provider, up.provider]).complete({
      messages: [],
    });
    expect(res.ok && res.value.model).toBe("m2");
  });

  it("tries the same model on another provider before a different model", async () => {
    const down = fakeProvider("down", "same", "mid", 1, HTTP(503));
    const other = fakeProvider("other", "different", "mid", 1);
    const twin = fakeProvider("twin", "same", "mid", 1);
    const res = await clientFor([
      down.provider,
      other.provider,
      twin.provider,
    ]).complete({ messages: [] });
    expect(res.ok && res.value.model).toBe("same");
    expect(other.calls).toEqual([]);
  });

  it("does not resend a request the provider rejected as invalid", async () => {
    const bad = fakeProvider("bad", "m1", "cheap", 1, HTTP(400));
    const other = fakeProvider("other", "m2", "cheap", 1);
    const res = await clientFor([bad.provider, other.provider]).complete({
      messages: [],
    });
    expect(res.ok).toBe(false);
    expect(other.calls).toEqual([]);
  });

  it("does not switch model when the caller pinned one", async () => {
    const down = fakeProvider("down", "m1", "cheap", 1, HTTP(500));
    const other = fakeProvider("other", "m2", "cheap", 1);
    const res = await clientFor([down.provider, other.provider]).complete({
      messages: [],
      model: "m1" as ModelId,
    });
    expect(res.ok).toBe(false);
    expect(other.calls).toEqual([]);
  });

  it("returns the first failure when every provider fails", async () => {
    const a = fakeProvider("a", "m1", "cheap", 1, HTTP(429));
    const b = fakeProvider("b", "m2", "cheap", 1, HTTP(500));
    const res = await clientFor([a.provider, b.provider]).complete({
      messages: [],
    });
    expect(!res.ok && res.error.details?.["status"]).toBe(429);
  });
});

describe("providersFromEnv with several entries", () => {
  const entry = (id: string, provider = "gemini", apiKey?: string) => ({
    id,
    provider,
    model: `model-${id}`,
    ...(apiKey ? { apiKey } : {}),
  });

  it("puts the active entry first by id, among entries of one vendor", () => {
    const providers = providersFromEnv({
      AI_REVIEW_LLM_PROVIDER: "gemini",
      AI_REVIEW_ACTIVE_PROVIDER_ID: "b",
      AI_PROVIDERS_JSON: JSON.stringify([entry("a"), entry("b"), entry("c")]),
    });
    expect(providers.map((p) => p.models()[0]!.id)).toEqual([
      "model-b",
      "model-a",
      "model-c",
    ]);
  });

  it("falls back to the first entry of the active type, keeping order", () => {
    const providers = providersFromEnv({
      AI_REVIEW_LLM_PROVIDER: "gemini",
      AI_PROVIDERS_JSON: JSON.stringify([
        entry("x", "openai"),
        entry("a"),
        entry("b"),
      ]),
    });
    expect(providers.map((p) => p.models()[0]!.id)).toEqual([
      "model-a",
      "model-x",
      "model-b",
    ]);
  });

  it("never sends the generic key to a non-active entry", async () => {
    const seen: Array<string | null> = [];
    const fetchSpy = async (_url: unknown, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get("authorization"));
      return new Response("nope", { status: 500 });
    };
    const original = globalThis.fetch;
    globalThis.fetch = fetchSpy as typeof fetch;
    try {
      const [active, other] = providersFromEnv({
        AI_REVIEW_LLM_PROVIDER: "openai",
        AI_REVIEW_ACTIVE_PROVIDER_ID: "a",
        AI_REVIEW_LLM_API_KEY: "active-key",
        AI_PROVIDERS_JSON: JSON.stringify([
          entry("a", "openai"),
          { ...entry("b", "ollama") },
        ]),
      });
      await active!.complete({ model: "m" as ModelId, messages: [] });
      await other!.complete({ model: "m" as ModelId, messages: [] });
    } finally {
      globalThis.fetch = original;
    }
    expect(seen).toEqual(["Bearer active-key", null]);
  });
});

describe("MockLLMProvider (via RoutingLLMClient)", () => {
  it("detects a hardcoded secret in an added diff line and returns JSON", async () => {
    const provider = new MockLLMProvider();
    const client = new RoutingLLMClient(
      [provider],
      new CheapestFirstRouter([provider]),
      {
        requiredCapabilities: ["text", "json_mode"],
        budget: BUDGET,
      },
    );
    const diff = [
      "+++ b/config.ts",
      "@@ -0,0 +1 @@",
      '+const apiKey = "supersecretvalue123";',
    ].join("\n");
    const res = await client.complete({
      messages: [
        { role: "system", content: "FOCUS:security" },
        { role: "user", content: diff },
      ],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const parsed = JSON.parse(res.value.content) as {
        issues: { category: string }[];
      };
      expect(parsed.issues.length).toBeGreaterThan(0);
      expect(parsed.issues[0]?.category).toBe("security");
      // Deterministic + free.
      expect(res.value.usage.completionTokens).toBeGreaterThan(0);
    }
  });

  it("reports no issues for a clean diff", async () => {
    const provider = new MockLLMProvider();
    const client = new RoutingLLMClient(
      [provider],
      new CheapestFirstRouter([provider]),
      {
        requiredCapabilities: ["text", "json_mode"],
        budget: BUDGET,
      },
    );
    const res = await client.complete({
      messages: [
        { role: "system", content: "FOCUS:security" },
        {
          role: "user",
          content: "+++ b/ok.ts\n@@ -0,0 +1 @@\n+export const x = 1;",
        },
      ],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const parsed = JSON.parse(res.value.content) as { issues: unknown[] };
      expect(parsed.issues).toHaveLength(0);
    }
  });
});
