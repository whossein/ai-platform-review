import { describe, it, expect } from "vitest";
import { InMemoryCache } from "@ai-review/shared";
import type {
  AsyncResult,
  LLMClient,
  LLMRequest,
  LLMResponse,
  ModelId,
} from "@ai-review/core";
import { CachingLLMClient, llmRequestKey } from "./cache.js";

type Completable = Omit<LLMRequest, "model"> & { model?: ModelId };

/** A client that counts real calls, so we can prove the cache prevents them. */
class CountingClient implements LLMClient {
  calls = 0;
  async complete(_request: Completable): AsyncResult<LLMResponse> {
    this.calls++;
    return {
      ok: true,
      value: {
        model: "mock" as ModelId,
        content: `response #${this.calls}`,
        usage: { promptTokens: 100, completionTokens: 50 },
        finishReason: "stop",
      },
    };
  }
}

const REQUEST: Completable = {
  messages: [{ role: "user", content: "review this diff" }],
  temperature: 0,
};

describe("CachingLLMClient", () => {
  it("calls the inner client on a miss and caches the result", async () => {
    const inner = new CountingClient();
    const client = new CachingLLMClient(
      inner,
      new InMemoryCache<LLMResponse>("llm_response"),
    );

    const first = await client.complete(REQUEST);
    expect(first.ok && first.value.content).toBe("response #1");
    expect(inner.calls).toBe(1);
    expect(client.misses).toBe(1);
  });

  it("serves an identical request from cache without a second real call", async () => {
    const inner = new CountingClient();
    const client = new CachingLLMClient(
      inner,
      new InMemoryCache<LLMResponse>("llm_response"),
    );

    await client.complete(REQUEST);
    const second = await client.complete(REQUEST);

    expect(inner.calls).toBe(1); // no second paid call
    expect(client.hits).toBe(1);
    expect(second.ok && second.value.fromCache).toBe(true);
    // A cache hit costs zero tokens — the whole point.
    expect(second.ok && second.value.usage.promptTokens).toBe(0);
    expect(second.ok && second.value.usage.completionTokens).toBe(0);
  });

  it("treats different content as a different key (cache miss)", async () => {
    const inner = new CountingClient();
    const client = new CachingLLMClient(
      inner,
      new InMemoryCache<LLMResponse>("llm_response"),
    );

    await client.complete(REQUEST);
    await client.complete({
      messages: [{ role: "user", content: "a different diff" }],
      temperature: 0,
    });
    expect(inner.calls).toBe(2);
  });

  it("keys are stable for equal requests and differ for different ones", () => {
    expect(llmRequestKey(REQUEST)).toBe(llmRequestKey({ ...REQUEST }));
    expect(llmRequestKey(REQUEST)).not.toBe(
      llmRequestKey({ ...REQUEST, temperature: 0.9 }),
    );
  });
});

describe("CachingLLMClient key isolation and bounds", () => {
  it("misses when the namespace differs, hits when it matches", async () => {
    const inner = new CountingClient();
    const shared = new InMemoryCache<LLMResponse>("llm_response");
    await new CachingLLMClient(inner, shared, "ns-a").complete(REQUEST);
    await new CachingLLMClient(inner, shared, "ns-b").complete(REQUEST);
    expect(inner.calls).toBe(2);
    await new CachingLLMClient(inner, shared, "ns-a").complete(REQUEST);
    expect(inner.calls).toBe(2);
  });

  it("misses when preferredTier differs", async () => {
    const inner = new CountingClient();
    const client = new CachingLLMClient(
      inner,
      new InMemoryCache<LLMResponse>("llm_response"),
    );
    await client.complete({ ...REQUEST, preferredTier: "cheap" });
    await client.complete({ ...REQUEST, preferredTier: "premium" });
    expect(inner.calls).toBe(2);
    await client.complete({ ...REQUEST, preferredTier: "cheap" });
    expect(inner.calls).toBe(2);
  });

  it("llmRequestKey varies with namespace and preferredTier", () => {
    expect(llmRequestKey(REQUEST, "a")).not.toBe(llmRequestKey(REQUEST, "b"));
    expect(llmRequestKey(REQUEST)).toBe(llmRequestKey(REQUEST, ""));
    expect(llmRequestKey({ ...REQUEST, preferredTier: "cheap" })).not.toBe(
      llmRequestKey(REQUEST),
    );
  });

  it("evicts LRU entries when the backing cache is bounded", async () => {
    const inner = new CountingClient();
    const client = new CachingLLMClient(
      inner,
      new InMemoryCache<LLMResponse>("llm_response", { maxEntries: 1 }),
    );
    const a: Completable = { messages: [{ role: "user", content: "a" }] };
    const b: Completable = { messages: [{ role: "user", content: "b" }] };
    await client.complete(a);
    await client.complete(b); // evicts a
    await client.complete(a);
    expect(inner.calls).toBe(3);
  });

  it("expires entries after the TTL (injected clock)", async () => {
    let t = 0;
    const inner = new CountingClient();
    const client = new CachingLLMClient(
      inner,
      new InMemoryCache<LLMResponse>("llm_response", {
        now: () => t,
        defaultTtlMs: 100,
      }),
    );
    await client.complete(REQUEST);
    t = 50;
    await client.complete(REQUEST);
    expect(inner.calls).toBe(1);
    t = 200;
    await client.complete(REQUEST);
    expect(inner.calls).toBe(2);
  });
});
