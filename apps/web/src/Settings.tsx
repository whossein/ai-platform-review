import { useState, useEffect } from "react";

export interface AIProviderConfig {
  id: string;
  provider: string;
  apiKey: string;
  model: string;
  baseUrl: string;
  tier?: "cheap" | "mid" | "premium" | "local" | string | undefined;
  inputCostPer1M?: number | undefined;
  outputCostPer1M?: number | undefined;
  enabled?: boolean;
  customAuthHeaderName?: string;
  customAuthHeaderPrefix?: string;
}

export interface GitConnection {
  id: string;
  name: string;
  type: "gitlab" | "github";
  /** Instance URL, e.g. https://gitlab.example.com. Empty = gitlab.com / github.com. */
  baseUrl: string;
  token: string;
}

export function defaultGitBaseUrl(type: GitConnection["type"]): string {
  return type === "github" ? "https://github.com" : "https://gitlab.com";
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Pick the git env overrides (token + base URL) for a PR/MR URL. A connection
 * whose host matches the URL wins; otherwise the first connection of the
 * same provider type is used.
 */
export function resolveGitEnv(
  config: Pick<AppConfig, "GIT_CONNECTIONS">,
  url?: string,
): Record<string, string> {
  const conns = (config.GIT_CONNECTIONS || []).filter((c) => c.token);
  if (conns.length === 0) return {};
  const host = url ? hostOf(url) : "";
  const byHost = host
    ? conns.find((c) => hostOf(c.baseUrl || defaultGitBaseUrl(c.type)) === host)
    : undefined;
  const type = host.includes("github") ? "github" : "gitlab";
  const conn = byHost || conns.find((c) => c.type === type);
  if (!conn) return {};
  const env: Record<string, string> =
    conn.type === "github"
      ? { GITHUB_TOKEN: conn.token }
      : { GITLAB_TOKEN: conn.token };
  if (conn.type === "gitlab" && conn.baseUrl) env.GITLAB_BASE_URL = conn.baseUrl;
  return env;
}

export interface AppConfig {
  AI_REVIEW_LLM_PROVIDER: string;
  AI_REVIEW_LLM_API_KEY: string;
  AI_REVIEW_LLM_MODEL: string;
  AI_REVIEW_LLM_BASE_URL: string;
  AI_PROVIDERS?: AIProviderConfig[];
  GITLAB_TOKEN: string;
  GITLAB_BASE_URL: string;
  GITHUB_TOKEN?: string;
  GIT_CONNECTIONS?: GitConnection[];
  BUDGET_LIMIT: string;
}

const DEFAULT_CONFIG: AppConfig = {
  AI_REVIEW_LLM_PROVIDER: "gemini",
  AI_REVIEW_LLM_API_KEY: "",
  AI_REVIEW_LLM_MODEL: "",
  AI_REVIEW_LLM_BASE_URL: "",
  GITLAB_TOKEN: "",
  GITLAB_BASE_URL: "",
  GITHUB_TOKEN: "",
  BUDGET_LIMIT: "0.5",
};

/** Convert the legacy single GitLab/GitHub token fields into connections. */
function migrateGitConnections(cfg: AppConfig): AppConfig {
  if (cfg.GIT_CONNECTIONS) return cfg;
  const conns: GitConnection[] = [];
  if (cfg.GITLAB_TOKEN)
    conns.push({
      id: "git_legacy_gitlab",
      name: "GitLab",
      type: "gitlab",
      baseUrl: cfg.GITLAB_BASE_URL || "",
      token: cfg.GITLAB_TOKEN,
    });
  if (cfg.GITHUB_TOKEN)
    conns.push({
      id: "git_legacy_github",
      name: "GitHub",
      type: "github",
      baseUrl: "",
      token: cfg.GITHUB_TOKEN,
    });
  return { ...cfg, GIT_CONNECTIONS: conns, GITLAB_TOKEN: "", GITHUB_TOKEN: "" };
}

export function useAppConfig() {
  const [config, setConfig] = useState<AppConfig>(() => {
    try {
      const stored = localStorage.getItem("ai-review-config");
      if (stored) return migrateGitConnections({ ...DEFAULT_CONFIG, ...JSON.parse(stored) });
    } catch {
      // ignore
    }
    return DEFAULT_CONFIG;
  });

  useEffect(() => {
    localStorage.setItem("ai-review-config", JSON.stringify(config));
  }, [config]);

  return [config, setConfig] as const;
}

export function SettingsModal({
  config,
  onChange,
  onClose,
}: {
  config: AppConfig;
  onChange: (c: AppConfig) => void;
  onClose: () => void;
}) {
  const [local, setLocal] = useState(config);

  const handleSave = () => {
    onChange(local);
    onClose();
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-content">
        <h2>Configuration</h2>
        <div className="form-group">
          <label>LLM Provider</label>
          <select
            value={local.AI_REVIEW_LLM_PROVIDER}
            onChange={(e) =>
              setLocal({ ...local, AI_REVIEW_LLM_PROVIDER: e.target.value })
            }
          >
            <option value="mock">Mock (Offline / Free)</option>
            <option value="gemini">Gemini</option>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="openrouter">OpenRouter</option>
            <option value="ollama">Ollama (Local / Free)</option>
            <option value="deepseek">DeepSeek</option>
            <option value="avalai">AvalAI (Iran Gateway)</option>
            <option value="azure">Azure OpenAI</option>
            <option value="custom">Custom / Proxy</option>
          </select>
        </div>
        <div className="form-group">
          <label>API Key</label>
          <input
            type="password"
            value={local.AI_REVIEW_LLM_API_KEY}
            onChange={(e) =>
              setLocal({ ...local, AI_REVIEW_LLM_API_KEY: e.target.value })
            }
            placeholder={
              local.AI_REVIEW_LLM_PROVIDER === "mock" ||
              local.AI_REVIEW_LLM_PROVIDER === "ollama"
                ? "Not required for this provider"
                : "Defaults to server env if empty"
            }
            disabled={
              local.AI_REVIEW_LLM_PROVIDER === "mock" ||
              local.AI_REVIEW_LLM_PROVIDER === "ollama"
            }
          />
        </div>
        <div className="form-group">
          <label>Model (Optional)</label>
          <input
            type="text"
            value={local.AI_REVIEW_LLM_MODEL}
            onChange={(e) =>
              setLocal({ ...local, AI_REVIEW_LLM_MODEL: e.target.value })
            }
            placeholder="Leave empty for default"
          />
        </div>
        <div className="form-group">
          <label>Base URL (Optional)</label>
          <input
            type="text"
            value={local.AI_REVIEW_LLM_BASE_URL}
            onChange={(e) =>
              setLocal({ ...local, AI_REVIEW_LLM_BASE_URL: e.target.value })
            }
            placeholder="Custom gateway URL"
          />
        </div>
        <div className="form-group">
          <label>Max Budget (USD)</label>
          <input
            type="number"
            step="0.001"
            min="0"
            value={local.BUDGET_LIMIT}
            onChange={(e) =>
              setLocal({ ...local, BUDGET_LIMIT: e.target.value })
            }
            placeholder="0.5 (Leave empty for no limit)"
          />
        </div>
        <div className="modal-actions">
          <button
            onClick={onClose}
            style={{
              background: "var(--panel)",
              border: "1px solid var(--border)",
            }}
          >
            Cancel
          </button>
          <button onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}
