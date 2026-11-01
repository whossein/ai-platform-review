/**
 * GitHub repository source for @ai-review/project-index.
 *
 * Uses GitHub REST API v3 via injectable `HttpClient` (`@ai-review/git`):
 *  - Default branch lookup: `GET /repos/:owner/:repo`
 *  - Ref commit resolution: `GET /repos/:owner/:repo/commits/:ref`
 *  - Recursive tree listing: `GET /repos/:owner/:repo/git/trees/:sha?recursive=1`
 *    (with automatic non-recursive subtree fallback when `truncated: true`)
 *  - Blob/content fetching: `GET /repos/:owner/:repo/git/blobs/:blob_sha`
 *    (with fallback to `GET /repos/:owner/:repo/contents/:path?ref=:sha`)
 */

import type { HttpClient } from "@ai-review/git";
import { normalizeRepoPath } from "../filters.js";
import { redactSecrets } from "../redact.js";
import {
  sendWithRateLimitRetry,
  throwIfAborted,
  type RateLimitRetryOptions,
  type RepositorySource,
  type ResolvedRef,
  type SourceTreeEntry,
} from "./source.js";

export interface GitHubSourceOptions {
  /** Repository path in `owner/repo` format. */
  readonly repositoryPath: string;
  /** Optional API base URL (defaults to `https://api.github.com` or `https://<host>/api/v3`). */
  readonly apiBaseUrl?: string | undefined;
  readonly gitHost?: string | undefined;
  readonly token?: string | undefined;
  readonly defaultBranch?: string | undefined;
  readonly maxRetryAfterMs?: number | undefined;
  readonly maxRateLimitRetries?: number | undefined;
}

interface GitHubRepoDto {
  default_branch?: string;
}

interface GitHubCommitDto {
  sha?: string;
}

interface GitHubTreeItemDto {
  path: string;
  mode?: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  size?: number;
}

interface GitHubTreeResponseDto {
  sha: string;
  tree: GitHubTreeItemDto[];
  truncated?: boolean;
}

interface GitHubBlobResponseDto {
  sha?: string;
  content?: string;
  encoding?: "base64" | "utf-8" | string;
}

export function resolveGitHubApiBaseUrl(
  gitHost?: string | undefined,
  explicitApiBaseUrl?: string | undefined,
): string {
  if (explicitApiBaseUrl?.trim()) {
    return explicitApiBaseUrl.trim().replace(/\/+$/, "");
  }
  const host = (gitHost ?? "github.com").toLowerCase().trim();
  if (!host || host === "github.com" || host === "www.github.com") {
    return "https://api.github.com";
  }
  return `https://${host}/api/v3`;
}

export class GitHubRepositorySource implements RepositorySource {
  readonly kind = "github" as const;
  private readonly apiBaseUrl: string;
  private readonly repoPath: string;
  private readonly token: string | undefined;
  private readonly defaultBranch: string | undefined;
  private readonly maxRetryAfterMs: number | undefined;
  private readonly maxRateLimitRetries: number | undefined;

  constructor(
    private readonly http: HttpClient,
    options: GitHubSourceOptions,
  ) {
    this.apiBaseUrl = resolveGitHubApiBaseUrl(
      options.gitHost,
      options.apiBaseUrl,
    );
    this.repoPath = options.repositoryPath.replace(/^\/+|\/+$/g, "");
    this.token = options.token;
    this.defaultBranch = options.defaultBranch;
    this.maxRetryAfterMs = options.maxRetryAfterMs;
    this.maxRateLimitRetries = options.maxRateLimitRetries;
  }

  private headers(): Readonly<Record<string, string>> {
    const base: Record<string, string> = {
      accept: "application/vnd.github+json",
      "user-agent": "AI-Review-Platform",
    };
    if (this.token) {
      base["authorization"] = `Bearer ${this.token}`;
    }
    return base;
  }

  private retryOpts(signal?: AbortSignal | undefined): RateLimitRetryOptions {
    return {
      maxRetries: this.maxRateLimitRetries,
      maxRetryAfterMs: this.maxRetryAfterMs,
      signal,
      secretsToRedact: [this.token],
    };
  }

  private formatHttpError(action: string, status: number, body: unknown): Error {
    const rawDetail =
      typeof body === "string"
        ? body
        : body && typeof body === "object" && "message" in body
          ? String((body as { message: unknown }).message)
          : JSON.stringify(body ?? "");
    const safeMsg = redactSecrets(
      `GitHub ${action} failed (HTTP ${status}): ${rawDetail}`,
      [this.token],
    );
    return new Error(safeMsg);
  }

  async resolveRef(
    ref?: string | undefined,
    signal?: AbortSignal | undefined,
  ): Promise<ResolvedRef> {
    throwIfAborted(signal);
    let targetRef = ref?.trim() || this.defaultBranch?.trim();

    if (!targetRef) {
      const repoRes = await sendWithRateLimitRetry(
        this.http,
        {
          method: "GET",
          url: `${this.apiBaseUrl}/repos/${this.repoPath}`,
          headers: this.headers(),
        },
        this.retryOpts(signal),
      );
      if (repoRes.status >= 400) {
        throw this.formatHttpError("repo lookup", repoRes.status, repoRes.body);
      }
      const dto = repoRes.body as GitHubRepoDto | undefined;
      targetRef = dto?.default_branch?.trim() || "main";
    }

    const commitRes = await sendWithRateLimitRetry(
      this.http,
      {
        method: "GET",
        url: `${this.apiBaseUrl}/repos/${this.repoPath}/commits/${encodeURIComponent(targetRef)}`,
        headers: this.headers(),
      },
      this.retryOpts(signal),
    );
    if (commitRes.status >= 400) {
      throw this.formatHttpError(
        `commit resolution for ref '${targetRef}'`,
        commitRes.status,
        commitRes.body,
      );
    }

    const commitDto = commitRes.body as GitHubCommitDto | undefined;
    if (!commitDto?.sha) {
      throw new Error(
        redactSecrets(
          `GitHub commit resolution for ref '${targetRef}' returned no SHA`,
          [this.token],
        ),
      );
    }

    return {
      ref: targetRef,
      commitSha: commitDto.sha,
    };
  }

  async listTree(
    commitSha: string,
    signal?: AbortSignal | undefined,
  ): Promise<readonly SourceTreeEntry[]> {
    throwIfAborted(signal);
    const url = `${this.apiBaseUrl}/repos/${this.repoPath}/git/trees/${encodeURIComponent(commitSha)}?recursive=1`;
    const res = await sendWithRateLimitRetry(
      this.http,
      {
        method: "GET",
        url,
        headers: this.headers(),
      },
      this.retryOpts(signal),
    );

    if (res.status >= 400) {
      throw this.formatHttpError("git tree", res.status, res.body);
    }

    const dto = res.body as GitHubTreeResponseDto | undefined;
    if (!dto || !Array.isArray(dto.tree)) {
      return [];
    }

    if (dto.truncated) {
      return this.walkSubtreesBreadthFirst(commitSha, signal);
    }

    const entries: SourceTreeEntry[] = [];
    for (const item of dto.tree) {
      if (item.type === "blob" && item.path) {
        entries.push({
          path: normalizeRepoPath(item.path),
          size: item.size,
          gitBlobSha: item.sha,
        });
      }
    }
    return entries;
  }

  /**
   * Fallback BFS tree walk used when GitHub's recursive tree API returns `truncated: true`.
   */
  private async walkSubtreesBreadthFirst(
    rootTreeSha: string,
    signal?: AbortSignal | undefined,
  ): Promise<readonly SourceTreeEntry[]> {
    const entries: SourceTreeEntry[] = [];
    const queue: Array<{ sha: string; prefix: string }> = [
      { sha: rootTreeSha, prefix: "" },
    ];
    let visitedTrees = 0;
    const maxTrees = 250;

    while (queue.length > 0 && visitedTrees < maxTrees) {
      throwIfAborted(signal);
      const current = queue.shift()!;
      visitedTrees += 1;

      const res = await sendWithRateLimitRetry(
        this.http,
        {
          method: "GET",
          url: `${this.apiBaseUrl}/repos/${this.repoPath}/git/trees/${encodeURIComponent(current.sha)}`,
          headers: this.headers(),
        },
        this.retryOpts(signal),
      );

      if (res.status >= 400) {
        throw this.formatHttpError(
          `subtree '${current.prefix || "/"}'`,
          res.status,
          res.body,
        );
      }

      const dto = res.body as GitHubTreeResponseDto | undefined;
      for (const item of dto?.tree ?? []) {
        const fullPath = normalizeRepoPath(
          current.prefix ? `${current.prefix}/${item.path}` : item.path,
        );
        if (item.type === "blob") {
          entries.push({
            path: fullPath,
            size: item.size,
            gitBlobSha: item.sha,
          });
        } else if (item.type === "tree") {
          queue.push({ sha: item.sha, prefix: fullPath });
        }
      }
    }

    return entries;
  }

  async readFile(
    entry: SourceTreeEntry,
    commitSha: string,
    signal?: AbortSignal | undefined,
  ): Promise<string> {
    throwIfAborted(signal);
    const normalizedPath = normalizeRepoPath(entry.path);

    if (entry.gitBlobSha) {
      const blobUrl = `${this.apiBaseUrl}/repos/${this.repoPath}/git/blobs/${encodeURIComponent(entry.gitBlobSha)}`;
      const blobRes = await sendWithRateLimitRetry(
        this.http,
        {
          method: "GET",
          url: blobUrl,
          headers: this.headers(),
        },
        this.retryOpts(signal),
      );

      if (blobRes.status >= 400) {
        throw this.formatHttpError(
          `git blob '${normalizedPath}'`,
          blobRes.status,
          blobRes.body,
        );
      }

      const dto = blobRes.body as GitHubBlobResponseDto | undefined;
      if (dto && typeof dto.content === "string") {
        if (dto.encoding === "base64") {
          return Buffer.from(dto.content.replace(/\s+/g, ""), "base64").toString(
            "utf8",
          );
        }
        return dto.content;
      }
    }

    // Fallback to contents API by path + commitSha
    const encodedSegments = normalizedPath
      .split("/")
      .map(encodeURIComponent)
      .join("/");
    const contentsUrl = `${this.apiBaseUrl}/repos/${this.repoPath}/contents/${encodedSegments}?ref=${encodeURIComponent(commitSha)}`;
    const contentsRes = await sendWithRateLimitRetry(
      this.http,
      {
        method: "GET",
        url: contentsUrl,
        headers: this.headers(),
      },
      this.retryOpts(signal),
    );

    if (contentsRes.status >= 400) {
      throw this.formatHttpError(
        `contents '${normalizedPath}'`,
        contentsRes.status,
        contentsRes.body,
      );
    }

    if (typeof contentsRes.body === "string") {
      return contentsRes.body;
    }
    const dto = contentsRes.body as GitHubBlobResponseDto | undefined;
    if (dto && typeof dto.content === "string") {
      if (dto.encoding === "base64") {
        return Buffer.from(dto.content.replace(/\s+/g, ""), "base64").toString(
          "utf8",
        );
      }
      return dto.content;
    }
    return "";
  }
}
