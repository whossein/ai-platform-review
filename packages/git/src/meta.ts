import type { MergeRequestAuthor } from "@ai-review/core";
import { parseChangeRequestUrl, baseUrlFromChangeRequestUrl } from "./url.js";

export interface ChangeRequestMeta {
  readonly title: string;
  readonly description?: string | undefined;
  readonly sourceBranch: string;
  readonly targetBranch: string;
  readonly author?: MergeRequestAuthor | undefined;
}

/**
 * Best-effort lookup of an MR/PR's title, branches and author from the git
 * provider. Never throws: any failure (no token, private repo, network)
 * yields `undefined` so reviews keep working without author info.
 */
export async function fetchChangeRequestMeta(
  url: string,
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch = fetch,
): Promise<ChangeRequestMeta | undefined> {
  const ref = parseChangeRequestUrl(url.trim());
  const origin = baseUrlFromChangeRequestUrl(url.trim());
  if (!ref || !origin || ref.id === "latest") return undefined;

  try {
    if (ref.provider === "gitlab") {
      const token = env.GITLAB_TOKEN || env.GIT_TOKEN || "";
      const base = env.GITLAB_BASE_URL || origin;
      const res = await fetchImpl(
        `${base}/api/v4/projects/${encodeURIComponent(ref.projectId)}/merge_requests/${encodeURIComponent(ref.id)}`,
        { headers: token ? { "private-token": token } : {} },
      );
      if (!res.ok) return undefined;
      const mr = (await res.json()) as Record<string, any>;
      const a = mr["author"];
      return {
        title: String(mr["title"] ?? ""),
        description: String(mr["description"] ?? ""),
        sourceBranch: String(mr["source_branch"] ?? ""),
        targetBranch: String(mr["target_branch"] ?? ""),
        author: a?.username
          ? {
              username: String(a.username),
              name: a.name ? String(a.name) : undefined,
              avatarUrl: a.avatar_url ? String(a.avatar_url) : undefined,
              profileUrl: a.web_url ? String(a.web_url) : undefined,
            }
          : undefined,
      };
    }

    if (ref.provider === "github") {
      const token = env.GITHUB_TOKEN || env.GIT_TOKEN;
      const api =
        origin === "https://github.com"
          ? "https://api.github.com"
          : `${origin}/api/v3`;
      const headers: Record<string, string> = {
        "User-Agent": "AI-Review-Platform",
        Accept: "application/vnd.github+json",
      };
      if (token) headers["Authorization"] = `token ${token}`;
      const res = await fetchImpl(
        `${api}/repos/${ref.projectId}/pulls/${encodeURIComponent(ref.id)}`,
        { headers },
      );
      if (!res.ok) return undefined;
      const pr = (await res.json()) as Record<string, any>;
      const u = pr["user"];
      return {
        title: String(pr["title"] ?? ""),
        description: String(pr["body"] ?? ""),
        sourceBranch: String(pr["head"]?.ref ?? ""),
        targetBranch: String(pr["base"]?.ref ?? ""),
        author: u?.login
          ? {
              username: String(u.login),
              avatarUrl: u.avatar_url ? String(u.avatar_url) : undefined,
              profileUrl: u.html_url ? String(u.html_url) : undefined,
            }
          : undefined,
      };
    }
  } catch {
    // network / parse failure: author info is optional
  }
  return undefined;
}

/**
 * Best-effort list of commit messages of an MR/PR (up to 100). Never throws;
 * returns `[]` when the provider or token does not allow it.
 */
export async function fetchChangeRequestCommitMessages(
  url: string,
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const ref = parseChangeRequestUrl(url.trim());
  const origin = baseUrlFromChangeRequestUrl(url.trim());
  if (!ref || !origin || ref.id === "latest") return [];
  try {
    if (ref.provider === "gitlab") {
      const token = env.GITLAB_TOKEN || env.GIT_TOKEN || "";
      const base = env.GITLAB_BASE_URL || origin;
      const res = await fetchImpl(
        `${base}/api/v4/projects/${encodeURIComponent(ref.projectId)}/merge_requests/${encodeURIComponent(ref.id)}/commits?per_page=100`,
        { headers: token ? { "private-token": token } : {} },
      );
      if (!res.ok) return [];
      const list = (await res.json()) as Record<string, unknown>[];
      return list.map((c) => String(c["message"] ?? "")).filter(Boolean);
    }
    if (ref.provider === "github") {
      const token = env.GITHUB_TOKEN || env.GIT_TOKEN;
      const api = origin === "https://github.com" ? "https://api.github.com" : `${origin}/api/v3`;
      const headers: Record<string, string> = {
        "User-Agent": "AI-Review-Platform",
        Accept: "application/vnd.github+json",
      };
      if (token) headers["Authorization"] = `token ${token}`;
      const res = await fetchImpl(
        `${api}/repos/${ref.projectId}/pulls/${encodeURIComponent(ref.id)}/commits?per_page=100`,
        { headers },
      );
      if (!res.ok) return [];
      const list = (await res.json()) as Record<string, any>[];
      return list.map((c) => String(c["commit"]?.message ?? "")).filter(Boolean);
    }
  } catch {
    // optional signal
  }
  return [];
}
