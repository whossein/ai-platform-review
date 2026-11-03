import { resolveGitEnv } from "./Settings.js";

/** Only the Git connection settings (token/base URL) of the review env. */
export function gitEnvFor(config: any, language: string, url: string): Record<string, string> {
  const all = buildEnvOverrides(config, language, url);
  return Object.fromEntries(Object.entries(all).filter(([k]) => /^(GITLAB|GITHUB|GIT)_(TOKEN|BASE_URL)$/.test(k)));
}

export function buildEnvOverrides(config: any, language: string, targetUrl?: string) {
  const envOverrides: Record<string, string> = {
    AI_REVIEW_LLM_PROVIDER: config.AI_REVIEW_LLM_PROVIDER || "gemini",
    AI_REVIEW_COMMENT_LANGUAGE: language,
  };
  const budgetLimit = parseFloat(config.BUDGET_LIMIT);
  if (Number.isFinite(budgetLimit) && budgetLimit > 0)
    envOverrides.AI_REVIEW_DOLLAR_BUDGET = String(budgetLimit);
  if (config.AI_REVIEW_LLM_API_KEY)
    envOverrides.AI_REVIEW_LLM_API_KEY = config.AI_REVIEW_LLM_API_KEY;
  if (config.AI_REVIEW_LLM_MODEL)
    envOverrides.AI_REVIEW_LLM_MODEL = config.AI_REVIEW_LLM_MODEL;
  if (config.AI_REVIEW_LLM_BASE_URL)
    envOverrides.AI_REVIEW_LLM_BASE_URL = config.AI_REVIEW_LLM_BASE_URL;

  if (config.AI_PROVIDERS && config.AI_PROVIDERS.length > 0) {
    const enabledProviders = config.AI_PROVIDERS.filter(
      (p: any) => p.enabled !== false,
    );
    envOverrides.AI_PROVIDERS_JSON = JSON.stringify(enabledProviders);

    // Find the currently active provider if AI_REVIEW_LLM_PROVIDER matches an ID or provider name
    const active = config.AI_PROVIDERS.find(
      (p: any) =>
        p.id === config.AI_REVIEW_LLM_PROVIDER ||
        p.provider === config.AI_REVIEW_LLM_PROVIDER,
    );
    if (active && active.enabled !== false) {
      envOverrides.AI_REVIEW_LLM_PROVIDER = active.provider;
      if (active.apiKey) envOverrides.AI_REVIEW_LLM_API_KEY = active.apiKey;
      if (active.model) envOverrides.AI_REVIEW_LLM_MODEL = active.model;
      if (active.baseUrl) envOverrides.AI_REVIEW_LLM_BASE_URL = active.baseUrl;
      if (active.inputCostPer1M !== undefined)
        envOverrides.AI_REVIEW_INPUT_COST_PER_1M = String(
          active.inputCostPer1M,
        );
      if (active.outputCostPer1M !== undefined)
        envOverrides.AI_REVIEW_OUTPUT_COST_PER_1M = String(
          active.outputCostPer1M,
        );
    } else if (active && active.enabled === false) {
      // If active is disabled, fallback to the first enabled one
      const fallback = enabledProviders[0];
      if (fallback) {
        envOverrides.AI_REVIEW_LLM_PROVIDER = fallback.provider;
        if (fallback.apiKey)
          envOverrides.AI_REVIEW_LLM_API_KEY = fallback.apiKey;
        if (fallback.model) envOverrides.AI_REVIEW_LLM_MODEL = fallback.model;
        if (fallback.baseUrl)
          envOverrides.AI_REVIEW_LLM_BASE_URL = fallback.baseUrl;
        if (fallback.inputCostPer1M !== undefined)
          envOverrides.AI_REVIEW_INPUT_COST_PER_1M = String(
            fallback.inputCostPer1M,
          );
        if (fallback.outputCostPer1M !== undefined)
          envOverrides.AI_REVIEW_OUTPUT_COST_PER_1M = String(
            fallback.outputCostPer1M,
          );
      }
    }

    for (const p of enabledProviders) {
      const prefix = p.provider.toUpperCase();
      if (p.apiKey) envOverrides[`AI_REVIEW_${prefix}_API_KEY`] = p.apiKey;
      if (p.model) envOverrides[`AI_REVIEW_${prefix}_MODEL`] = p.model;
      if (p.baseUrl) envOverrides[`AI_REVIEW_${prefix}_BASE_URL`] = p.baseUrl;
    }
  }

  if (config.GITLAB_TOKEN) envOverrides.GITLAB_TOKEN = config.GITLAB_TOKEN;
  if (config.GITLAB_BASE_URL)
    envOverrides.GITLAB_BASE_URL = config.GITLAB_BASE_URL;
  if (config.GITHUB_TOKEN) envOverrides.GITHUB_TOKEN = config.GITHUB_TOKEN;
  Object.assign(envOverrides, resolveGitEnv(config, targetUrl));

  return envOverrides;
}
