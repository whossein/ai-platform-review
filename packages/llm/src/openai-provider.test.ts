/**
 * OpenAI-compatible provider tests (ADR-0007).
 *
 * A fake `fetch` simulates the Chat Completions API so the real provider is
 * verified offline: request shape, auth header, JSON-mode, usage mapping, error
 * handling, and env-based construction (incl. the mock-fallback contract).
 */

import { describe, it, expect } from "vitest";
import type { LLMRequest, ModelId } from "@ai-review/core";
import {
  OpenAICompatibleProvider,
  providerFromEnv,
} from "./openai-provider.js";

function fakeFetch(
  status: number,
  body: unknown,
  capture?: (init: RequestInit) => void,
) {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    capture?.(init ?? {});
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () =>
        typeof body === "string" ? body : JSON.stringify(body),
    } as Response;
  }) as unknown as typeof fetch;
}

const REQ: LLMRequest = {
  model: "gpt-4o-mini" as ModelId,
  messages: [
    { role: "system", content: "You are a reviewer." },
    { role: "user", content: "Review this." },
  ],
  temperature: 0.2,
  jsonSchema: { type: "object" },
};

describe("OpenAICompatibleProvider", () => {
  it("sends a well-formed request and maps the response", async () => {
    let seen: RequestInit = {};
    const provider = new OpenAICompatibleProvider({
      providerId: "provider.openai",
      baseUrl: "https://api.openai.com/v1/",
      apiKey: "sk-test",
      models: [{ id: "gpt-4o-mini", tier: "cheap" }],
      fetchImpl: fakeFetch(
        200,
        {
          choices: [
            { message: { content: '{"issues":[]}' }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 12, completion_tokens: 3 },
        },
        (init) => (seen = init),
      ),
    });

    const res = await provider.complete(REQ);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.content).toBe('{"issues":[]}');
      expect(res.value.usage.promptTokens).toBe(12);
      expect(res.value.finishReason).toBe("stop");
    }

    // Auth header + JSON mode + model are in the request body.
    const headers = seen.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer sk-test");
    const body = JSON.parse(String(seen.body));
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "review_result",
        schema: { type: "object" },
        strict: true,
      },
    });
    expect(body.temperature).toBe(0.2);
  });

  function rejectingProvider(rejectTypes: string[], errorStatus = 400) {
    const sent: Array<Record<string, any>> = [];
    const provider = new OpenAICompatibleProvider({
      providerId: "provider.openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      models: [{ id: "gpt-4o-mini", tier: "cheap" }],
      fetchImpl: (async (_u: unknown, init?: RequestInit) => {
        const b = JSON.parse(String(init?.body));
        sent.push(b);
        const type = b.response_format?.type ?? "none";
        const ok = !rejectTypes.includes(type);
        const payload = ok
          ? { choices: [{ message: { content: "{}" } }], usage: {} }
          : { error: { message: "Unsupported response_format" } };
        return {
          ok,
          status: ok ? 200 : errorStatus,
          text: async () => JSON.stringify(payload),
        } as Response;
      }) as unknown as typeof fetch,
    });
    return { provider, sent };
  }

  it("falls back from json_schema to json_object when rejected", async () => {
    const { provider, sent } = rejectingProvider(["json_schema"]);
    const res = await provider.complete(REQ);
    expect(res.ok).toBe(true);
    expect(sent.map((b) => b.response_format?.type)).toEqual([
      "json_schema",
      "json_object",
    ]);
  });

  it("falls back all the way to no response_format", async () => {
    const { provider, sent } = rejectingProvider(["json_schema", "json_object"]);
    const res = await provider.complete(REQ);
    expect(res.ok).toBe(true);
    expect(sent.map((b) => b.response_format?.type)).toEqual([
      "json_schema",
      "json_object",
      undefined,
    ]);
  });

  it("does not retry on unrelated errors", async () => {
    const sent: unknown[] = [];
    const provider = new OpenAICompatibleProvider({
      providerId: "provider.openai",
      baseUrl: "https://api.openai.com/v1",
      models: [{ id: "gpt-4o-mini", tier: "cheap" }],
      fetchImpl: fakeFetch(400, { error: "context too long" }, (i) =>
        sent.push(i),
      ),
    });
    const res = await provider.complete(REQ);
    expect(res.ok).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it("reports cached prompt tokens when the provider returns them", async () => {
    const provider = new OpenAICompatibleProvider({
      providerId: "provider.openai",
      baseUrl: "https://api.openai.com/v1",
      models: [{ id: "gpt-4o-mini", tier: "cheap" }],
      fetchImpl: fakeFetch(200, {
        choices: [{ message: { content: "{}" } }],
        usage: {
          prompt_tokens: 2000,
          completion_tokens: 5,
          prompt_tokens_details: { cached_tokens: 1536 },
        },
      }),
    });
    const res = await provider.complete(REQ);
    expect(res.ok && res.value.usage.cachedPromptTokens).toBe(1536);
  });

  it("omits the auth header when no api key (e.g. local Ollama)", async () => {
    let seen: RequestInit = {};
    const provider = new OpenAICompatibleProvider({
      providerId: "provider.ollama",
      baseUrl: "http://localhost:11434/v1",
      models: [{ id: "qwen2.5-coder", tier: "local" }],
      fetchImpl: fakeFetch(
        200,
        { choices: [{ message: { content: "{}" } }], usage: {} },
        (init) => (seen = init),
      ),
    });
    await provider.complete({ ...REQ, model: "qwen2.5-coder" as ModelId });
    const headers = seen.headers as Record<string, string>;
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("surfaces HTTP errors", async () => {
    const provider = new OpenAICompatibleProvider({
      providerId: "provider.openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "bad",
      models: [{ id: "gpt-4o-mini", tier: "cheap" }],
      fetchImpl: fakeFetch(401, { error: "unauthorized" }),
    });
    const res = await provider.complete(REQ);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("llm.http_error");
  });

  it("advertises its configured models to the router", () => {
    const provider = new OpenAICompatibleProvider({
      providerId: "provider.openai",
      baseUrl: "https://api.openai.com/v1",
      models: [{ id: "gpt-4o-mini", tier: "cheap", inputCostPer1M: 0.15 }],
    });
    const models = provider.models();
    expect(models[0]?.id).toBe("gpt-4o-mini");
    expect(models[0]?.capabilities).toContain("json_mode");
  });
});

describe("providerFromEnv", () => {
  it("returns undefined when no credentials are set (falls back to mock)", () => {
    expect(providerFromEnv({})).toBeUndefined();
  });

  it("builds an OpenAI provider from an API key", () => {
    const p = providerFromEnv({ AI_REVIEW_LLM_API_KEY: "sk-x" });
    expect(p).toBeInstanceOf(OpenAICompatibleProvider);
  });

  it("builds an AvalAI provider from AVALAI_API_KEY alias", () => {
    const p = providerFromEnv({
      AI_REVIEW_LLM_PROVIDER: "avalai",
      AVALAI_API_KEY: "aa-test-key",
    });
    expect(p).toBeInstanceOf(OpenAICompatibleProvider);
    expect(p?.id).toBe("provider.avalai");
  });
});
