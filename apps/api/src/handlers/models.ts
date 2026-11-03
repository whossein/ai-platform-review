/**
 * Models handler — Fetch available models from LLM provider.
 *
 * Queries the /v1/models endpoint of the active LLM provider and returns
 * the list of available models.
 */

import { isTrustedEndpoint, stripLlmSecrets } from "./client-env.js";

export interface ModelsRequest {
  readonly provider: string;
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly customAuthHeaderName?: string;
  readonly customAuthHeaderPrefix?: string;
}

export interface ModelsResponse {
  ok: boolean;
  models: string[];
}

export async function modelsHandler(
  request: ModelsRequest
): Promise<ModelsResponse> {
  const { provider, apiKey, baseUrl, customAuthHeaderName, customAuthHeaderPrefix } =
    request;

  if (!provider) {
    throw new Error("Provider name is required");
  }

  const { resolveProviderPreset, resolveApiKey } = await import("@ai-review/llm");
  const preset = resolveProviderPreset(provider) ?? resolveProviderPreset("openai")!;

  const effectiveBaseUrl = baseUrl || preset.defaultBaseUrl;
  // A client-chosen endpoint must never receive the server's own LLM keys.
  const effectiveApiKey = resolveApiKey(
    provider,
    preset.envPrefix,
    apiKey,
    isTrustedEndpoint(provider, baseUrl, process.env) ? process.env : stripLlmSecrets(process.env),
  );

  if (!effectiveBaseUrl) {
    throw new Error("Base URL missing");
  }

  // Fetch from /v1/models endpoint typical for OpenAI compatible services
  const modelsUrl = effectiveBaseUrl.endsWith("/")
    ? `${effectiveBaseUrl}models`
    : `${effectiveBaseUrl}/models`;
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (effectiveApiKey) {
    if (customAuthHeaderName) {
      headers[customAuthHeaderName] = customAuthHeaderPrefix
        ? `${customAuthHeaderPrefix}${effectiveApiKey}`
        : effectiveApiKey;
    } else if (provider === "anthropic" || effectiveBaseUrl.includes("anthropic.com")) {
      headers["x-api-key"] = effectiveApiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else if (
      effectiveBaseUrl.includes("googleapis.com") ||
      effectiveBaseUrl.includes("generativelanguage")
    ) {
      headers["x-goog-api-key"] = effectiveApiKey;
    } else if (
      effectiveBaseUrl.includes("azure.com") ||
      effectiveBaseUrl.includes("openai.azure.com")
    ) {
      headers["api-key"] = effectiveApiKey;
    } else {
      headers["Authorization"] = `Bearer ${effectiveApiKey}`;
    }
  }

  const response = await fetch(modelsUrl, { headers });
  if (!response.ok) {
    throw new Error(`Status ${response.status}: ${await response.text()}`);
  }

  const data: any = await response.json();

  let modelsArray: any[] = [];
  if (Array.isArray(data)) {
    modelsArray = data;
  } else if (data && Array.isArray(data.data)) {
    modelsArray = data.data;
  } else if (data && Array.isArray(data.models)) {
    modelsArray = data.models;
  }

  const models: string[] = modelsArray
    .map((m: any) => {
      if (typeof m === "string") return m;
      return m.id || m.name || m.model;
    })
    .filter(Boolean);

  return { ok: true, models };
}
