/**
 * Test Git Connection handler — verifies a Git host token by fetching the
 * authenticated user from the GitLab / GitHub API.
 */

export interface TestGitConnectionRequest {
  readonly type: "gitlab" | "github";
  readonly baseUrl?: string;
  readonly token?: string;
}

export interface TestGitConnectionResponse {
  ok: boolean;
  username?: string;
  latencyMs?: number;
  error?: string;
}

function userEndpoint(type: "gitlab" | "github", baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  if (type === "gitlab") return `${base}/api/v4/user`;
  return base === "https://github.com"
    ? "https://api.github.com/user"
    : `${base}/api/v3/user`;
}

/**
 * Rejects hosts that could be used to probe the server's own machine or cloud
 * metadata with the user's token. Private LAN ranges stay allowed because
 * self-hosted GitLab/GHE instances commonly live there.
 */
function isBlockedHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "::1" || h === "::" || h.startsWith("fe80:")) return true;
  if (/^(?:::ffff:)?(?:127\.|0\.|169\.254\.)/.test(h)) return true;
  return h === "metadata.google.internal";
}

export async function testGitConnectionHandler(
  request: TestGitConnectionRequest,
): Promise<TestGitConnectionResponse> {
  const { type, token } = request;
  if (type !== "gitlab" && type !== "github") {
    return { ok: false, error: "Unsupported Git provider type" };
  }
  if (!token?.trim()) return { ok: false, error: "Token is required" };

  const baseUrl =
    request.baseUrl?.trim() ||
    (type === "github" ? "https://github.com" : "https://gitlab.com");
  if (!/^https?:\/\//i.test(baseUrl)) {
    return { ok: false, error: "Base URL must start with http:// or https://" };
  }

  let hostname: string;
  try {
    hostname = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return { ok: false, error: "Base URL is not a valid URL" };
  }
  if (isBlockedHost(hostname)) {
    return {
      ok: false,
      error: "Base URL points to a loopback, link-local or metadata address, which is not allowed",
    };
  }

  const headers: Record<string, string> =
    type === "gitlab"
      ? { "PRIVATE-TOKEN": token.trim() }
      : {
          authorization: `Bearer ${token.trim()}`,
          accept: "application/vnd.github+json",
          "user-agent": "ai-code-review",
        };

  const started = Date.now();
  try {
    const res = await fetch(userEndpoint(type, baseUrl), {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      const hint =
        res.status === 401 || res.status === 403
          ? "token is invalid or lacks permission"
          : res.status === 404
            ? "API not found — check the Base URL"
            : "request failed";
      return { ok: false, latencyMs, error: `HTTP ${res.status}: ${hint}` };
    }
    const data = (await res.json().catch(() => ({}))) as {
      username?: string;
      login?: string;
    };
    const username = data.username || data.login;
    return { ok: true, latencyMs, ...(username ? { username } : {}) };
  } catch (err: any) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: err?.message || "Could not reach the Git host",
    };
  }
}
