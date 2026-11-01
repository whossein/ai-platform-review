/**
 * GitLab repository source for @ai-review/project-index.
 *
 * Uses GitLab REST API v4 via injectable `HttpClient` (`@ai-review/git`):
 *  - Default branch lookup: `GET /api/v4/projects/:id`
 *  - Ref commit resolution: `GET /api/v4/projects/:id/repository/commits/:ref`
 *  - Paginated tree listing: `GET /api/v4/projects/:id/repository/tree?recursive=true&per_page=100&page=:page&ref=:sha`
 *  - Raw file content: `GET /api/v4/projects/:id/repository/files/:file_path/raw?ref=:sha`
 */

import type { HttpClient } from "@ai-review/git";
import { normalizeRepoPath } from "../filters.js";
import { redactSecrets } from "../redact.js";
import {
  orderBranches,
  sendWithRateLimitRetry,
  throwIfAborted,
  type RateLimitRetryOptions,
  type RepositorySource,
  type ResolvedRef,
  type SourceTreeEntry,
  type BranchListing,
} from "./source.js";

export interface GitLabSourceOptions {
  readonly baseUrl: string;
  readonly projectPath: string;
  readonly token?: string | undefined;
  readonly defaultBranch?: string | undefined;
  readonly maxRetryAfterMs?: number | undefined;
  readonly maxRateLimitRetries?: number | undefined;
}

interface GitLabProjectDto {
  default_branch?: string;
}

interface GitLabCommitDto {
  id: string;
}

interface GitLabTreeItemDto {
  id: string;
  name: string;
  type: "blob" | "tree" | "commit";
  path: string;
  mode?: string;
}

export class GitLabRepositorySource implements RepositorySource {
  readonly kind = "gitlab" as const;
  private readonly baseUrl: string;
  private readonly encodedProjectId: string;
  private readonly token: string | undefined;
  private readonly defaultBranch: string | undefined;
  private readonly maxRetryAfterMs: number | undefined;
  private readonly maxRateLimitRetries: number | undefined;

  constructor(
    private readonly http: HttpClient,
    options: GitLabSourceOptions,
  ) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.encodedProjectId = encodeURIComponent(
      options.projectPath.replace(/^\/+|\/+$/g, ""),
    );
    this.token = options.token;
    this.defaultBranch = options.defaultBranch;
    this.maxRetryAfterMs = options.maxRetryAfterMs;
    this.maxRateLimitRetries = options.maxRateLimitRetries;
  }

  private authHeaders(): Readonly<Record<string, string>> {
    if (!this.token) return {};
    return { "private-token": this.token };
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
          ? JSON.stringify((body as { message: unknown }).message)
          : JSON.stringify(body ?? "");
    const safeMsg = redactSecrets(
      `GitLab ${action} failed (HTTP ${status}): ${rawDetail}`,
      [this.token],
    );
    return new Error(safeMsg);
  }

  async listBranches(signal?: AbortSignal | undefined): Promise<BranchListing> {
    throwIfAborted(signal);
    const projRes = await sendWithRateLimitRetry(
      this.http,
      {
        method: "GET",
        url: `${this.baseUrl}/api/v4/projects/${this.encodedProjectId}`,
        headers: this.authHeaders(),
      },
      this.retryOpts(signal),
    );
    if (projRes.status >= 400) {
      throw this.formatHttpError("project lookup", projRes.status, projRes.body);
    }
    const defaultBranch =
      (projRes.body as GitLabProjectDto | undefined)?.default_branch?.trim() ||
      "main";

    const names: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const res = await sendWithRateLimitRetry(
        this.http,
        {
          method: "GET",
          url: `${this.baseUrl}/api/v4/projects/${this.encodedProjectId}/repository/branches?per_page=100&page=${page}`,
          headers: this.authHeaders(),
        },
        this.retryOpts(signal),
      );
      if (res.status >= 400) {
        throw this.formatHttpError("branch listing", res.status, res.body);
      }
      const items = Array.isArray(res.body)
        ? (res.body as { name?: string }[])
        : [];
      for (const b of items) if (b.name) names.push(b.name);
      if (items.length < 100) break;
    }
    return { defaultBranch, branches: orderBranches(defaultBranch, names) };
  }

  async resolveRef(
    ref?: string | undefined,
    signal?: AbortSignal | undefined,
  ): Promise<ResolvedRef> {
    throwIfAborted(signal);
    let targetRef = ref?.trim() || this.defaultBranch?.trim();

    if (!targetRef) {
      const projRes = await sendWithRateLimitRetry(
        this.http,
        {
          method: "GET",
          url: `${this.baseUrl}/api/v4/projects/${this.encodedProjectId}`,
          headers: this.authHeaders(),
        },
        this.retryOpts(signal),
      );
      if (projRes.status >= 400) {
        throw this.formatHttpError(
          "project lookup",
          projRes.status,
          projRes.body,
        );
      }
      const projDto = projRes.body as GitLabProjectDto | undefined;
      targetRef = projDto?.default_branch?.trim() || "main";
    }

    const commitRes = await sendWithRateLimitRetry(
      this.http,
      {
        method: "GET",
        url: `${this.baseUrl}/api/v4/projects/${this.encodedProjectId}/repository/commits/${encodeURIComponent(targetRef)}`,
        headers: this.authHeaders(),
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

    const commitDto = commitRes.body as GitLabCommitDto | undefined;
    if (!commitDto?.id) {
      throw new Error(
        redactSecrets(
          `GitLab commit resolution for ref '${targetRef}' returned no commit SHA`,
          [this.token],
        ),
      );
    }

    return {
      ref: targetRef,
      commitSha: commitDto.id,
    };
  }

  async listTree(
    commitSha: string,
    signal?: AbortSignal | undefined,
  ): Promise<readonly SourceTreeEntry[]> {
    const entries: SourceTreeEntry[] = [];
    let page = 1;
    const perPage = 100;
    const maxPages = 200; // hard safety guard (20,000 items)

    while (page <= maxPages) {
      throwIfAborted(signal);
      const url = `${this.baseUrl}/api/v4/projects/${this.encodedProjectId}/repository/tree?recursive=true&per_page=${perPage}&page=${page}&ref=${encodeURIComponent(commitSha)}`;
      const res = await sendWithRateLimitRetry(
        this.http,
        {
          method: "GET",
          url,
          headers: this.authHeaders(),
        },
        this.retryOpts(signal),
      );

      if (res.status >= 400) {
        throw this.formatHttpError("repository tree", res.status, res.body);
      }

      const items = Array.isArray(res.body)
        ? (res.body as GitLabTreeItemDto[])
        : [];
      for (const item of items) {
        if (item.type === "blob" && item.path) {
          entries.push({
            path: normalizeRepoPath(item.path),
            gitBlobSha: item.id,
          });
        }
      }

      const nextPageHeader =
        res.headers?.["x-next-page"] ?? res.headers?.["X-Next-Page"];
      if (nextPageHeader !== undefined) {
        const trimmedNext = nextPageHeader.trim();
        if (!trimmedNext) break;
        const parsedNext = Number.parseInt(trimmedNext, 10);
        if (!Number.isFinite(parsedNext) || parsedNext <= page) break;
        page = parsedNext;
      } else if (items.length < perPage) {
        break;
      } else {
        page += 1;
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
    const encodedPath = encodeURIComponent(normalizedPath);
    const url = `${this.baseUrl}/api/v4/projects/${this.encodedProjectId}/repository/files/${encodedPath}/raw?ref=${encodeURIComponent(commitSha)}`;
    const res = await sendWithRateLimitRetry(
      this.http,
      {
        method: "GET",
        url,
        headers: this.authHeaders(),
      },
      this.retryOpts(signal),
    );

    if (res.status >= 400) {
      throw this.formatHttpError(
        `raw file fetch '${normalizedPath}'`,
        res.status,
        res.body,
      );
    }

    if (typeof res.body === "string") {
      return res.body;
    }
    if (res.body === undefined || res.body === null) {
      return "";
    }
    return JSON.stringify(res.body);
  }
}
