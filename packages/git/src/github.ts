/**
 * GitHub provider — implements the same `GitProvider` contract as GitLab so
 * reviews started from a pull-request URL can be published back as inline
 * review comments + a summary comment.
 *
 * Works with github.com and GitHub Enterprise (`<origin>/api/v3`). It depends
 * only on the injectable `HttpClient`, so it is unit-testable offline.
 */

import type {
  AsyncResult,
  ChangeRequest,
  ChangeRequestRef,
  Discussion,
  GitProvider,
  GitProviderKind,
  PipelineStatus,
  PlatformError,
} from "@ai-review/core";
import type { HttpClient, HttpRequest } from "./http.js";
import { trimTrailingSlashes } from "@ai-review/shared";

export interface GitHubOptions {
  /** Web origin, e.g. https://github.com or https://ghe.example.com */
  readonly baseUrl: string;
  /** Personal access token (needs `repo` / pull-request write access). */
  readonly token: string;
}

function providerError(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): PlatformError {
  return {
    category: "provider",
    code,
    message,
    ...(details ? { details } : {}),
  };
}

function mapCombinedStatus(raw: unknown): PipelineStatus {
  switch (raw) {
    case "success":
      return "success";
    case "failure":
    case "error":
      return "failed";
    case "pending":
      return "pending";
    default:
      return "unknown";
  }
}

export class GitHubProvider implements GitProvider {
  readonly kind: GitProviderKind = "github";
  private readonly api: string;

  constructor(
    private readonly http: HttpClient,
    private readonly opts: GitHubOptions,
  ) {
    const origin = trimTrailingSlashes(opts.baseUrl);
    this.api =
      origin === "https://github.com" || origin === "https://www.github.com"
        ? "https://api.github.com"
        : `${origin}/api/v3`;
  }

  private prPath(ref: ChangeRequestRef): string {
    return `${this.api}/repos/${ref.projectId}/pulls/${encodeURIComponent(ref.id)}`;
  }

  private async call(
    method: HttpRequest["method"],
    url: string,
    body?: unknown,
    accept = "application/vnd.github+json",
  ): AsyncResult<unknown> {
    const res = await this.http.send({
      method,
      url,
      headers: {
        Authorization: `Bearer ${this.opts.token}`,
        Accept: accept,
        "User-Agent": "AI-Review-Platform",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      ...(body !== undefined ? { body } : {}),
    });
    if (!res.ok) return res;
    const { status, body: payload } = res.value;
    if (status < 200 || status >= 300) {
      const detail =
        payload && typeof payload === "object"
          ? String((payload as Record<string, unknown>)["message"] ?? "")
          : "";
      return {
        ok: false,
        error: providerError(
          "github.http_error",
          `GitHub returned HTTP ${status}${detail ? `: ${detail}` : ""}`,
          { status, url },
        ),
      };
    }
    return { ok: true, value: payload };
  }

  private async headSha(ref: ChangeRequestRef): AsyncResult<string> {
    const res = await this.call("GET", this.prPath(ref));
    if (!res.ok) return res;
    const head = (res.value as Record<string, any>)["head"];
    return { ok: true, value: String(head?.sha ?? "") };
  }

  async getChangeRequest(ref: ChangeRequestRef): AsyncResult<ChangeRequest> {
    const res = await this.call("GET", this.prPath(ref));
    if (!res.ok) return res;
    const pr = res.value as Record<string, any>;
    const state = pr["merged"] || pr["merged_at"]
      ? "merged"
      : pr["state"] === "closed"
        ? "closed"
        : "open";
    return {
      ok: true,
      value: {
        ref,
        title: String(pr["title"] ?? ""),
        description: String(pr["body"] ?? ""),
        sourceBranch: String(pr["head"]?.ref ?? ""),
        targetBranch: String(pr["base"]?.ref ?? ""),
        author: String(pr["user"]?.login ?? ""),
        state,
      },
    };
  }

  async getDiff(ref: ChangeRequestRef): AsyncResult<string> {
    const res = await this.call(
      "GET",
      this.prPath(ref),
      undefined,
      "application/vnd.github.v3.diff",
    );
    if (!res.ok) return res;
    return { ok: true, value: typeof res.value === "string" ? res.value : "" };
  }

  async listDiscussions(
    ref: ChangeRequestRef,
  ): AsyncResult<readonly Discussion[]> {
    const res = await this.call("GET", `${this.prPath(ref)}/comments?per_page=100`);
    if (!res.ok) return res;
    const raw = Array.isArray(res.value)
      ? (res.value as Record<string, any>[])
      : [];
    return {
      ok: true,
      value: raw.map((c) => ({
        id: String(c["id"] ?? ""),
        // The REST API does not expose thread resolution.
        resolved: false,
        body: String(c["body"] ?? ""),
        ...(c["path"]
          ? {
              location: {
                file: String(c["path"]),
                ...((c["line"] ?? c["original_line"]) != null
                  ? { line: Number(c["line"] ?? c["original_line"]) }
                  : {}),
              },
            }
          : {}),
      })),
    };
  }

  async createDiscussion(
    ref: ChangeRequestRef,
    body: string,
    location?: { readonly file: string; readonly line?: number },
  ): AsyncResult<Discussion> {
    const issueComment = (text: string) =>
      this.call(
        "POST",
        `${this.api}/repos/${ref.projectId}/issues/${encodeURIComponent(ref.id)}/comments`,
        { body: text },
      );

    let res: Awaited<AsyncResult<unknown>> | undefined;
    let positioned = false;
    if (location && location.line !== undefined) {
      const sha = await this.headSha(ref);
      if (sha.ok && sha.value) {
        positioned = true;
        res = await this.call("POST", `${this.prPath(ref)}/comments`, {
          body,
          commit_id: sha.value,
          path: location.file,
          line: location.line,
          side: "RIGHT",
        });
      }
    }
    if (!res || (!res.ok && positioned)) {
      // Lines outside the diff hunk are rejected (422); degrade to a plain
      // PR comment that still names the file/line.
      const where = location
        ? `${location.file}${location.line !== undefined ? `:${location.line}` : ""}`
        : undefined;
      res = await issueComment(where ? `📍 \`${where}\`\n\n${body}` : body);
    }
    if (!res.ok) return res;
    const c = res.value as Record<string, unknown>;
    return {
      ok: true,
      value: {
        id: String(c["id"] ?? ""),
        resolved: false,
        body: String(c["body"] ?? body),
        ...(location ? { location } : {}),
      },
    };
  }

  async replyDiscussion(
    ref: ChangeRequestRef,
    discussionId: string,
    body: string,
  ): AsyncResult<Discussion> {
    const res = await this.call(
      "POST",
      `${this.prPath(ref)}/comments/${encodeURIComponent(discussionId)}/replies`,
      { body },
    );
    if (!res.ok) return res;
    const c = res.value as Record<string, unknown>;
    return {
      ok: true,
      value: {
        id: discussionId,
        resolved: false,
        body: String(c["body"] ?? body),
      },
    };
  }

  async resolveDiscussion(
    _ref: ChangeRequestRef,
    _discussionId: string,
  ): AsyncResult<void> {
    // Resolving review threads needs GraphQL; not supported over REST.
    return {
      ok: false,
      error: providerError(
        "github.resolve_unsupported",
        "Resolving review threads is not supported for GitHub yet",
      ),
    };
  }

  async approve(ref: ChangeRequestRef): AsyncResult<void> {
    const res = await this.call("POST", `${this.prPath(ref)}/reviews`, {
      event: "APPROVE",
    });
    if (!res.ok) return res;
    return { ok: true, value: undefined };
  }

  async getPipelineStatus(ref: ChangeRequestRef): AsyncResult<PipelineStatus> {
    const sha = await this.headSha(ref);
    if (!sha.ok) return sha;
    if (!sha.value) return { ok: true, value: "unknown" };
    const res = await this.call(
      "GET",
      `${this.api}/repos/${ref.projectId}/commits/${sha.value}/status`,
    );
    if (!res.ok) return res;
    return {
      ok: true,
      value: mapCombinedStatus((res.value as Record<string, unknown>)["state"]),
    };
  }
}
