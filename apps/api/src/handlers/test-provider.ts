/**
 * Test Provider handler — Ping LLM provider connectivity.
 *
 * Tests whether the configured LLM provider is reachable and returns a simple
 * completion response. Used for validating API keys and endpoint health.
 */

import { isTrustedEndpoint, stripLlmSecrets } from "./client-env.js";

export interface TestProviderRequest {
  readonly provider: string;
  readonly apiKey?: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly customAuthHeaderName?: string;
  readonly customAuthHeaderPrefix?: string;
}

export interface TestProviderResponse {
  ok: boolean;
  message?: string;
  latencyMs?: number;
  model?: string;
  usage?: unknown;
  error?: string;
}

export async function testProviderHandler(
  request: TestProviderRequest
): Promise<TestProviderResponse> {
  const {
    provider,
    apiKey,
    model,
    baseUrl,
    customAuthHeaderName,
    customAuthHeaderPrefix,
  } = request;

  if (!provider) {
    throw new Error("Provider name is required");
  }

  if (provider === "mock") {
    return {
      ok: true,
      message:
        "Mock Provider (Offline mode, zero cost). Ready to simulate code reviews.",
      latencyMs: 8,
      model: "mock-deterministic",
    };
  }

  const { resolveProviderPreset, OpenAICompatibleProvider, resolveApiKey } =
    await import("@ai-review/llm");
  const preset = resolveProviderPreset(provider) ?? resolveProviderPreset("openai")!;

  const effectiveBaseUrl = baseUrl || preset.defaultBaseUrl;
  const effectiveModel = model || preset.defaultModel;
  // A client-chosen endpoint must never receive the server's own LLM keys.
  const customEndpoint = !isTrustedEndpoint(provider, baseUrl, process.env);
  const effectiveApiKey = resolveApiKey(
    provider,
    preset.envPrefix,
    apiKey,
    customEndpoint ? stripLlmSecrets(process.env) : process.env,
  );

  if (!effectiveBaseUrl) {
    throw new Error(
      `Base URL is missing for provider "${provider}". Please configure an endpoint URL.`
    );
  }

  if (preset.requiresApiKey && !effectiveApiKey && provider !== "ollama") {
    throw new Error(
      `API Key is required for provider "${provider}". Please enter a valid API key or configure it in server environment.`
    );
  }

  const startTime = Date.now();
  const testClient = new OpenAICompatibleProvider({
    providerId: `test.${provider}`,
    baseUrl: effectiveBaseUrl,
    ...(effectiveApiKey ? { apiKey: effectiveApiKey } : {}),
    ...(customAuthHeaderName ? { customAuthHeaderName } : {}),
    ...(customAuthHeaderPrefix ? { customAuthHeaderPrefix } : {}),
    models: [{ id: effectiveModel, tier: preset.defaultTier }],
  });

  const response = await testClient.complete({
    model: effectiveModel as any,
    messages: [{ role: "user", content: 'Respond with the single word "OK".' }],
    maxTokens: 10,
  });

  const latencyMs = Date.now() - startTime;

  if (!response.ok) {
    const err: any = new Error(response.error.message || "Provider request failed");
    err.latencyMs = latencyMs;
    throw err;
  }

  const snippet = response.value.content.trim().slice(0, 80) || "OK";
  return {
    ok: true,
    message: `Successfully connected! Response: "${snippet}"`,
    latencyMs,
    model: effectiveModel,
    usage: response.value.usage,
  };
}
