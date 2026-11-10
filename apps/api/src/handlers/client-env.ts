/**
 * Client env merging — builds the effective environment for a request from the
 * server's own env and the env overrides sent by the browser.
 *
 * Security: the client must never be able to make the server send its own LLM
 * API keys to an endpoint the client chose, nor raise the server's budgets.
 */

import { resolveProviderPreset } from "@ai-review/llm";
import { parseChangeRequestUrl } from "@ai-review/git";
import { trimTrailingSlashes } from "@ai-review/shared";

/** Orchestrator defaults, used as the budget ceiling when the server sets none. */
const BUDGET_DEFAULTS = {
  AI_REVIEW_TOKEN_BUDGET: { max: 2_000_000, integer: true },
  AI_REVIEW_DOLLAR_BUDGET: { max: 25, integer: false },
  AI_REVIEW_EXECUTION_BUDGET_MS: { max: 600_000, integer: true },
} as const;

/** Server-held LLM secrets: every name resolveApiKey reads ends in `_API_KEY`. */
function isLlmSecretKey(key: string): boolean {
  return /_API_KEY$/.test(key);
}

type Env = Record<string, string | undefined>;

/** Copy of `env` without any LLM API key. */
export function stripLlmSecrets(env: Env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined && !isLlmSecretKey(k)) out[k] = v;
  }
  return out;
}

function parseBudget(raw: string | undefined, integer: boolean): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return integer ? Math.floor(n) : n;
}

function normUrl(url: string): string {
  return trimTrailingSlashes(url.trim()).toLowerCase();
}

/**
 * Whether `baseUrl` is an endpoint the server operator already trusts for the
 * provider: the preset's official URL or one the server itself configured.
 */
export function isTrustedEndpoint(
  provider: string | undefined,
  baseUrl: string | undefined,
  serverEnv: Env,
): boolean {
  if (!baseUrl || !baseUrl.trim()) return true; // falls back to the preset default
  const wanted = normUrl(baseUrl);
  const trusted: (string | undefined)[] = [serverEnv["AI_REVIEW_LLM_BASE_URL"]];
  if (provider) {
    const preset = resolveProviderPreset(provider);
    trusted.push(preset?.defaultBaseUrl);
    trusted.push(serverEnv[`AI_REVIEW_${(preset?.envPrefix ?? provider).toUpperCase()}_BASE_URL`]);
  }
  return trusted.some((t) => t && normUrl(t) === wanted);
}

/** True if the client defines any LLM endpoint the server does not trust. */
function hasUntrustedEndpoint(serverEnv: Env, client: Record<string, string>): boolean {
  const activeProvider = client["AI_REVIEW_LLM_PROVIDER"] ?? serverEnv["AI_REVIEW_LLM_PROVIDER"];

  const json = client["AI_PROVIDERS_JSON"];
  if (json !== undefined && json !== serverEnv["AI_PROVIDERS_JSON"]) {
    try {
      const list = JSON.parse(json);
      if (!Array.isArray(list)) return true;
      for (const p of list) {
        if (!p || typeof p !== "object") return true;
        if (!isTrustedEndpoint(String(p.provider ?? "openai"), p.baseUrl, serverEnv)) return true;
      }
    } catch {
      return true;
    }
  }

  for (const [k, v] of Object.entries(client)) {
    const m = /^AI_REVIEW_(.+)_BASE_URL$/.exec(k);
    if (!m || v === serverEnv[k]) continue;
    const provider = m[1] === "LLM" ? activeProvider : m[1]!.toLowerCase();
    if (!isTrustedEndpoint(provider, v, serverEnv)) return true;
  }
  return false;
}

const GIT_TOKEN_KEYS = ["GITLAB_TOKEN", "GITHUB_TOKEN", "GIT_TOKEN"] as const;

function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Server-level Git tokens may only travel to a Git host the server is
 * configured for: gitlab.com (or the server's GITLAB_BASE_URL) and github.com.
 * Returns the set of server token keys that may be kept for this request.
 */
function trustedGitTokenKeys(
  serverEnv: Env,
  merged: Record<string, string>,
  targetUrl: string | undefined,
): Set<string> {
  const keep = new Set<string>();
  const ref = targetUrl ? parseChangeRequestUrl(targetUrl) : undefined;
  if (!targetUrl || !ref) return keep;
  if (ref.provider === "gitlab") {
    const effective = originOf(merged["GITLAB_BASE_URL"]) ?? originOf(targetUrl);
    const trusted = originOf(serverEnv["GITLAB_BASE_URL"]) ?? "https://gitlab.com";
    if (effective && effective === trusted) {
      keep.add("GITLAB_TOKEN");
      keep.add("GIT_TOKEN");
    }
  } else if (ref.provider === "github") {
    if (originOf(targetUrl) === "https://github.com") {
      keep.add("GITHUB_TOKEN");
      keep.add("GIT_TOKEN");
    }
  }
  return keep;
}

export interface EffectiveEnvOptions {
  /** The MR/PR URL (or raw diff) this request works on; decides which server Git tokens may be used. */
  readonly targetUrl?: string | undefined;
}

export function buildEffectiveEnv(
  serverEnv: Env,
  clientEnv: Env | undefined | null,
  options: EffectiveEnvOptions = {},
): Record<string, string> {
  const client: Record<string, string> = {};
  for (const [k, v] of Object.entries(clientEnv ?? {})) {
    if (typeof v === "string") client[k] = v;
  }

  const stripLlm = hasUntrustedEndpoint(serverEnv, client);

  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(serverEnv)) {
    if (v === undefined) continue;
    if (stripLlm && isLlmSecretKey(k)) continue;
    base[k] = v;
  }

  const merged: Record<string, string> = { ...base, ...client };

  // Server Git tokens are only sent to the Git host the server is set up for.
  const keepTokens = trustedGitTokenKeys(serverEnv, merged, options.targetUrl);
  for (const key of GIT_TOKEN_KEYS) {
    if (key in base && !(key in client) && !keepTokens.has(key)) delete merged[key];
  }

  // Budgets: the client may only lower the server's limit.
  for (const [key, { max, integer }] of Object.entries(BUDGET_DEFAULTS)) {
    if (!(key in client)) continue;
    const ceiling = parseBudget(serverEnv[key], integer) ?? max;
    const requested = parseBudget(client[key], integer);
    if (requested !== undefined && requested <= ceiling) {
      merged[key] = client[key]!;
    } else if (serverEnv[key] !== undefined) {
      merged[key] = serverEnv[key]!;
    } else {
      delete merged[key];
    }
  }

  return merged;
}
