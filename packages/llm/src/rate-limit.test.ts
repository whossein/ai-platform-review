/** Rate-limit handling: header parsing, bounded waits, failover, concurrency. */
import { describe, it, expect } from "vitest";
import type { LLMRequest } from "@ai-review/core";
import {
  CheapestFirstRouter,
  OpenAICompatibleProvider,
  RoutingLLMClient,
  type RoutingClientOptions,
} from "./index.js";
import {
  computeWaitMs,
  parseDurationMs,
  parseRetryAfterMs,
  rateLimitWaitMs,
  resolveMaxConcurrency,
} from "./rate-limit.js";

type Step = { status: number; headers?: Record<string, string>; body?: unknown };
const OK = {
  status: 200,
  body: {
    choices: [{ message: { content: "{}" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  },
};

function scripted(steps: Step[], seen: { calls: number } = { calls: 0 }) {
  return (async () => {
    const step = steps[Math.min(seen.calls, steps.length - 1)]!;
    seen.calls++;
    const h = new Map(
      Object.entries(step.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
    );
    return {
      ok: step.status < 300,
      status: step.status,
      headers: { get: (n: string) => h.get(n.toLowerCase()) ?? null },
      text: async () => JSON.stringify(step.body ?? { error: "x" }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

const provider = (id: string, fetchImpl: typeof fetch, model = "m") =>
  new OpenAICompatibleProvider({
    providerId: `provider.${id}`,
    baseUrl: "https://example.test/v1",
    apiKey: "sk-secret",
    models: [{ id: model, tier: "cheap" }],
    fetchImpl,
  });

const REQ: Omit<LLMRequest, "model"> = {
  messages: [{ role: "user", content: "hi" }],
};

function client(
  providers: OpenAICompatibleProvider[],
  opts: RoutingClientOptions = {},
) {
  const sleeps: number[] = [];
  const logs: string[] = [];
  const c = new RoutingLLMClient(
    providers,
    new CheapestFirstRouter(providers),
    { requiredCapabilities: ["text"], budget: { tokenBudget: 1, dollarBudget: 1, executionBudgetMs: 1 } },
    {
      sleep: async (ms) => void sleeps.push(ms),
      random: () => 0,
      warn: (m) => void logs.push(m),
      ...opts,
    },
  );
  return { c, sleeps, logs };
}

describe("header parsing", () => {
  it("parses durations", () => {
    expect(parseDurationMs("49s")).toBe(49_000);
    expect(parseDurationMs("1m30s")).toBe(90_000);
    expect(parseDurationMs("200ms")).toBe(200);
    expect(parseDurationMs("soon")).toBeUndefined();
    expect(parseDurationMs("5x")).toBeUndefined();
  });
  it("parses Retry-After seconds and dates", () => {
    expect(parseRetryAfterMs("7")).toBe(7000);
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(parseRetryAfterMs("Thu, 01 Jan 2026 00:00:30 GMT", now)).toBe(30_000);
    expect(parseRetryAfterMs("nonsense")).toBeUndefined();
  });
  it("prefers the exhausted bucket", () => {
    const h = new Map([
      ["x-ratelimit-reset-requests", "5s"],
      ["x-ratelimit-remaining-requests", "0"],
      ["x-ratelimit-reset-tokens", "40s"],
      ["x-ratelimit-remaining-tokens", "900"],
    ]);
    expect(rateLimitWaitMs({ get: (n) => h.get(n) ?? null })).toBe(5000);
  });
  it("reads the env override", () => {
    expect(resolveMaxConcurrency({ AI_REVIEW_LLM_MAX_CONCURRENCY: "2" })).toBe(2);
    expect(resolveMaxConcurrency({ AI_REVIEW_LLM_MAX_CONCURRENCY: "0" })).toBe(4);
    expect(resolveMaxConcurrency({})).toBe(4);
  });
  it("jitters below the cap when the hint is capped", () => {
    const p = { maxWaitMs: 60_000, baseBackoffMs: 2000, random: () => 1 };
    expect(computeWaitMs(3_600_000, 1, p)).toBeLessThanOrEqual(60_000);
    expect(computeWaitMs(3_600_000, 1, p)).toBeLessThan(60_000);
  });
});

describe("RoutingLLMClient rate limits", () => {
  it("waits for Retry-After then succeeds", async () => {
    const seen = { calls: 0 };
    const { c, sleeps, logs } = client([
      provider("a", scripted([{ status: 429, headers: { "retry-after": "3" } }, OK], seen)),
    ]);
    const res = await c.complete(REQ);
    expect(res.ok).toBe(true);
    expect(seen.calls).toBe(2);
    expect(sleeps).toEqual([3000]);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("provider.a");
    expect(logs[0]).toContain("429");
    expect(logs[0]).not.toContain("sk-secret");
  });

  it("honors x-ratelimit-reset-requests", async () => {
    const { c, sleeps } = client([
      provider(
        "a",
        scripted([
          {
            status: 429,
            headers: {
              "x-ratelimit-limit-requests": "50",
              "x-ratelimit-remaining-requests": "0",
              "x-ratelimit-reset-requests": "49s",
            },
          },
          OK,
        ]),
      ),
    ]);
    expect((await c.complete(REQ)).ok).toBe(true);
    expect(sleeps).toEqual([49_000]);
  });

  it("falls back to exponential backoff on a malformed header", async () => {
    const { c, sleeps } = client([
      provider(
        "a",
        scripted([
          { status: 429, headers: { "retry-after": "garbage" } },
          { status: 429 },
          OK,
        ]),
      ),
    ]);
    expect((await c.complete(REQ)).ok).toBe(true);
    expect(sleeps).toEqual([2000, 4000]);
  });

  it("caps a huge header", async () => {
    const { c, sleeps } = client([
      provider("a", scripted([{ status: 429, headers: { "retry-after": "86400" } }, OK])),
    ]);
    expect((await c.complete(REQ)).ok).toBe(true);
    expect(sleeps[0]).toBeLessThanOrEqual(60_000);
  });

  it("bounds attempts and surfaces the existing error shape, non-retryable", async () => {
    const seen = { calls: 0 };
    const { c, sleeps } = client(
      [provider("a", scripted([{ status: 429, headers: { "retry-after": "1" } }], seen))],
      { maxAttempts: 3 },
    );
    const res = await c.complete(REQ);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(seen.calls).toBe(3);
    expect(sleeps).toHaveLength(2);
    expect(res.error.code).toBe("llm.http_error");
    expect(res.error.details?.["status"]).toBe(429);
    expect(res.error.retryable).toBe(false);
  });

  it("bounds the total wait", async () => {
    const seen = { calls: 0 };
    const { c } = client(
      [provider("a", scripted([{ status: 429, headers: { "retry-after": "50" } }], seen))],
      { maxAttempts: 10, maxTotalWaitMs: 120_000 },
    );
    expect((await c.complete(REQ)).ok).toBe(false);
    expect(seen.calls).toBe(3); // two 50s waits fit, the third would not
  });

  it("does not retry a non-429 4xx", async () => {
    const seen = { calls: 0 };
    const { c, sleeps } = client([provider("a", scripted([{ status: 401 }], seen))]);
    const res = await c.complete(REQ);
    expect(res.ok).toBe(false);
    expect(seen.calls).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it("does not wait on an exhausted billing quota", async () => {
    const seen = { calls: 0 };
    const { c, sleeps } = client([
      provider("a", scripted([{ status: 429, body: { error: { code: "insufficient_quota" } } }], seen)),
    ]);
    expect((await c.complete(REQ)).ok).toBe(false);
    expect(seen.calls).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it("fails over to a second provider without waiting", async () => {
    const { c, sleeps } = client([
      provider("a", scripted([{ status: 429, headers: { "retry-after": "49" } }]), "m1"),
      provider("b", scripted([OK]), "m2"),
    ]);
    const res = await c.complete(REQ);
    expect(res.ok).toBe(true);
    expect(sleeps).toEqual([]);
  });

  it("limits in-flight requests per provider", async () => {
    let inFlight = 0;
    let peak = 0;
    const fetchImpl = (async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify(OK.body),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const { c } = client([provider("a", fetchImpl)], { maxConcurrency: 2 });
    const results = await Promise.all(Array.from({ length: 7 }, () => c.complete(REQ)));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(peak).toBe(2);
  });
});
