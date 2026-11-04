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

/** A model as listed by the provider; price/context are present only when the provider reports them. */
export interface ModelInfo {
  id: string;
  name?: string;
  /** USD per 1M input tokens */
  inputCostPer1M?: number | undefined;
  /** USD per 1M output tokens */
  outputCostPer1M?: number | undefined;
  contextLength?: number | undefined;
}

export interface ModelsResponse {
  ok: boolean;
  /** Model ids (kept for backward compatibility). */
  models: string[];
  modelInfos: ModelInfo[];
}

function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Round away float noise from per-token → per-1M conversion. */
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * Normalise the heterogeneous /models payloads (OpenAI, OpenRouter, Together,
 * Gemini, Ollama...) into ModelInfo. Prices are only filled in when the
 * provider reports them (OpenRouter: USD per token; Together: USD per 1M).
 */
export function normalizeModels(raw: unknown[]): ModelInfo[] {
  const seen = new Set<string>();
  const out: ModelInfo[] = [];
  for (const m of raw as any[]) {
    let id: string | undefined;
    if (typeof m === "string") id = m;
    else if (m && typeof m === "object") id = m.id || m.name || m.model;
    if (typeof id !== "string" || !id) continue;
    id = id.replace(/^models\//, "");
    if (seen.has(id)) continue;
    seen.add(id);

    const info: ModelInfo = { id };
    if (m && typeof m === "object") {
      const display = m.display_name || m.displayName;
      if (typeof display === "string" && display && display !== id) info.name = display;
      else if (typeof m.name === "string" && m.name && m.name !== id && m.id) info.name = m.name;

      const pricing = m.pricing;
      if (pricing && typeof pricing === "object") {
        const perTokenIn = num(pricing.prompt);
        const perTokenOut = num(pricing.completion);
        if (perTokenIn !== undefined) info.inputCostPer1M = round6(perTokenIn * 1e6);
        if (perTokenOut !== undefined) info.outputCostPer1M = round6(perTokenOut * 1e6);
        if (perTokenIn === undefined && perTokenOut === undefined) {
          info.inputCostPer1M = num(pricing.input);
          info.outputCostPer1M = num(pricing.output);
        }
      }
      info.contextLength =
        num(m.context_length) ?? num(m.context_window) ?? num(m.inputTokenLimit) ?? num(m.max_context_length);
    }
    for (const k of Object.keys(info) as (keyof ModelInfo)[]) {
      if (info[k] === undefined) delete info[k];
    }
    out.push(info);
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
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

  const modelInfos = normalizeModels(modelsArray);
  return { ok: true, models: modelInfos.map((m) => m.id), modelInfos };
}
