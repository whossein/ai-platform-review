import { describe, it, expect } from "vitest";
import { buildEffectiveEnv, stripLlmSecrets } from "./client-env.js";

const server = {
  OPENAI_API_KEY: "sk-server",
  AI_REVIEW_LLM_API_KEY: "generic-server",
  GITLAB_TOKEN: "gl-server",
  AI_REVIEW_LLM_PROVIDER: "openai",
};

describe("buildEffectiveEnv", () => {
  it("keeps server keys when the client does not override the endpoint", () => {
    const env = buildEffectiveEnv(server, { AI_REVIEW_COMMENT_LANGUAGE: "fa" });
    expect(env.OPENAI_API_KEY).toBe("sk-server");
    expect(env.AI_REVIEW_LLM_API_KEY).toBe("generic-server");
    expect(env.AI_REVIEW_COMMENT_LANGUAGE).toBe("fa");
  });

  it("strips server LLM keys when the client redefines the endpoint", () => {
    for (const key of ["AI_PROVIDERS_JSON", "AI_REVIEW_LLM_BASE_URL", "AI_REVIEW_OPENAI_BASE_URL"]) {
      const env = buildEffectiveEnv(server, { [key]: "https://evil.example/v1" });
      expect(env.OPENAI_API_KEY).toBeUndefined();
      expect(env.AI_REVIEW_LLM_API_KEY).toBeUndefined();
      expect(env.AI_REVIEW_LLM_PROVIDER).toBe("openai");
      expect(env[key]).toBe("https://evil.example/v1");
    }
  });

  it("keeps server keys for official or server-configured endpoints (keyless provider list)", () => {
    const list = JSON.stringify([
      { provider: "openai" },
      { provider: "openai", baseUrl: "https://api.openai.com/v1/" },
    ]);
    const env = buildEffectiveEnv(server, {
      AI_PROVIDERS_JSON: list,
      AI_REVIEW_LLM_PROVIDER: "openai",
      AI_REVIEW_LLM_BASE_URL: "https://api.openai.com/v1",
      AI_REVIEW_OPENAI_BASE_URL: "https://api.openai.com/v1/",
    });
    expect(env.OPENAI_API_KEY).toBe("sk-server");
    const own = buildEffectiveEnv({ ...server, AI_REVIEW_LLM_BASE_URL: "https://gw/v1" }, { AI_REVIEW_LLM_BASE_URL: "https://gw/v1/" });
    expect(own.OPENAI_API_KEY).toBe("sk-server");
  });

  it("strips when any provider in the list has a custom URL or the JSON is invalid", () => {
    const list = JSON.stringify([{ provider: "openai" }, { provider: "openai", baseUrl: "https://evil.example/v1" }]);
    expect(buildEffectiveEnv(server, { AI_PROVIDERS_JSON: list }).OPENAI_API_KEY).toBeUndefined();
    expect(buildEffectiveEnv(server, { AI_PROVIDERS_JSON: "{" }).OPENAI_API_KEY).toBeUndefined();
  });

  it("keeps keys supplied by the client", () => {
    const env = buildEffectiveEnv(server, {
      AI_REVIEW_LLM_BASE_URL: "https://mine.example/v1",
      AI_REVIEW_LLM_API_KEY: "client-key",
    });
    expect(env.AI_REVIEW_LLM_API_KEY).toBe("client-key");
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  it("does not treat an unchanged server endpoint as an override", () => {
    const env = buildEffectiveEnv(
      { ...server, AI_REVIEW_LLM_BASE_URL: "https://srv/v1" },
      { AI_REVIEW_LLM_BASE_URL: "https://srv/v1" },
    );
    expect(env.OPENAI_API_KEY).toBe("sk-server");
  });

  it("lets the client only lower budgets", () => {
    const s = { AI_REVIEW_TOKEN_BUDGET: "1000" };
    expect(buildEffectiveEnv(s, { AI_REVIEW_TOKEN_BUDGET: "500" }).AI_REVIEW_TOKEN_BUDGET).toBe("500");
    expect(buildEffectiveEnv(s, { AI_REVIEW_TOKEN_BUDGET: "5000" }).AI_REVIEW_TOKEN_BUDGET).toBe("1000");
    expect(buildEffectiveEnv(s, { AI_REVIEW_TOKEN_BUDGET: "abc" }).AI_REVIEW_TOKEN_BUDGET).toBe("1000");
  });

  it("uses orchestrator defaults as ceiling when the server sets none", () => {
    expect(buildEffectiveEnv({}, { AI_REVIEW_DOLLAR_BUDGET: "100" }).AI_REVIEW_DOLLAR_BUDGET).toBeUndefined();
    expect(buildEffectiveEnv({}, { AI_REVIEW_DOLLAR_BUDGET: "5" }).AI_REVIEW_DOLLAR_BUDGET).toBe("5");
    expect(buildEffectiveEnv({}, { AI_REVIEW_EXECUTION_BUDGET_MS: "700000" }).AI_REVIEW_EXECUTION_BUDGET_MS).toBeUndefined();
    expect(buildEffectiveEnv({}, { AI_REVIEW_TOKEN_BUDGET: "-1" }).AI_REVIEW_TOKEN_BUDGET).toBeUndefined();
  });
});

describe("server git tokens", () => {
  const gitServer = { GITLAB_TOKEN: "gl-server", GITHUB_TOKEN: "gh-server", GIT_TOKEN: "generic" };
  const mr = "https://gitlab.com/g/p/-/merge_requests/1";

  it("sends server tokens only to gitlab.com / github.com by default", () => {
    const gl = buildEffectiveEnv(gitServer, {}, { targetUrl: mr });
    expect(gl.GITLAB_TOKEN).toBe("gl-server");
    expect(gl.GITHUB_TOKEN).toBeUndefined();
    const gh = buildEffectiveEnv(gitServer, {}, { targetUrl: "https://github.com/o/r/pull/3" });
    expect(gh.GITHUB_TOKEN).toBe("gh-server");
    expect(gh.GITLAB_TOKEN).toBeUndefined();
  });

  it("drops server tokens for an arbitrary host or raw diff", () => {
    for (const targetUrl of ["https://evil.example/g/p/-/merge_requests/1", "https://evil.example/o/r/pull/3", "diff --git a b", undefined]) {
      const env = buildEffectiveEnv(gitServer, {}, { targetUrl });
      expect(env.GITLAB_TOKEN).toBeUndefined();
      expect(env.GITHUB_TOKEN).toBeUndefined();
      expect(env.GIT_TOKEN).toBeUndefined();
    }
  });

  it("drops server tokens when the client redirects GITLAB_BASE_URL", () => {
    const env = buildEffectiveEnv(gitServer, { GITLAB_BASE_URL: "https://evil.example" }, { targetUrl: mr });
    expect(env.GITLAB_TOKEN).toBeUndefined();
  });

  it("allows the server's configured self-hosted GitLab", () => {
    const s = { ...gitServer, GITLAB_BASE_URL: "https://git.corp.example" };
    const ok = buildEffectiveEnv(s, {}, { targetUrl: "https://git.corp.example/g/p/-/merge_requests/1" });
    expect(ok.GITLAB_TOKEN).toBe("gl-server");
    const bad = buildEffectiveEnv(s, {}, { targetUrl: "https://evil.example/g/p/-/merge_requests/1" });
    // the resolver would use the server's GITLAB_BASE_URL, so the token still goes to the trusted host
    expect(bad.GITLAB_TOKEN).toBe("gl-server");
  });

  it("keeps the user's own injected token for any host", () => {
    const env = buildEffectiveEnv(gitServer, { GITLAB_TOKEN: "user-token" }, { targetUrl: "https://git.corp.example/g/p/-/merge_requests/1" });
    expect(env.GITLAB_TOKEN).toBe("user-token");
    expect(env.GIT_TOKEN).toBeUndefined();
  });
});

describe("stripLlmSecrets", () => {
  it("removes only API keys", () => {
    expect(stripLlmSecrets(server)).toEqual({ GITLAB_TOKEN: "gl-server", AI_REVIEW_LLM_PROVIDER: "openai" });
  });
});
