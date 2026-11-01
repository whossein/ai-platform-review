/**
 * Concurrent-safe, cancellable job manager (`IndexJobManager`) for @ai-review/project-index.
 *
 * Guarantees:
 *  - At most one active (`queued` | `running`) job per `projectId`.
 *  - Cancellation via `AbortController`.
 *  - Secret/token redaction on all persisted `job.json` error messages.
 */

import { randomBytes } from "node:crypto";
import type { Project, ProjectId } from "@ai-review/core";
import { FetchHttpClient, type HttpClient } from "@ai-review/git";
import { ProjectIndexer } from "./indexer.js";
import { redactSecrets } from "./redact.js";
import { GitHubRepositorySource } from "./sources/github-source.js";
import { GitLabRepositorySource } from "./sources/gitlab-source.js";
import { LocalRepositorySource } from "./sources/local-source.js";
import type { RepositorySource } from "./sources/source.js";
import type { ProjectIndexStore } from "./store.js";
import type {
  GitSourceCredentials,
  IndexJob,
  IndexJobProgress,
  IndexOptions,
} from "./types.js";

export interface StartIndexJobInput {
  readonly project: Project;
  readonly ref?: string | undefined;
  readonly localPath?: string | undefined;
  readonly credentials?: GitSourceCredentials | undefined;
  readonly options?: Omit<IndexOptions, "signal" | "onProgress" | "ref"> | undefined;
  /** Optional custom source override for testing or custom providers. */
  readonly sourceOverride?: RepositorySource | undefined;
}

interface ActiveJobHandle {
  job: IndexJob;
  controller: AbortController;
  promise: Promise<IndexJob>;
}

export class IndexJobManager {
  private readonly activeJobs = new Map<string, ActiveJobHandle>();
  private readonly indexer: ProjectIndexer;
  private readonly httpClient: HttpClient;

  constructor(
    private readonly store: ProjectIndexStore,
    httpClient?: HttpClient,
  ) {
    this.indexer = new ProjectIndexer(store);
    this.httpClient = httpClient ?? new FetchHttpClient();
  }

  /**
   * Builds the appropriate `RepositorySource` (local, GitHub, or GitLab) for a Project.
   */
  createSourceForProject(input: StartIndexJobInput): RepositorySource {
    if (input.sourceOverride) {
      return input.sourceOverride;
    }

    const effectiveLocalPath =
      input.localPath?.trim() || input.project.localPath?.trim();
    if (effectiveLocalPath) {
      return new LocalRepositorySource({
        rootDir: effectiveLocalPath,
        defaultBranch: input.project.defaultBranch,
      });
    }

    const host = input.project.gitHost.toLowerCase();
    const token = input.credentials?.token;
    const baseUrl = input.credentials?.baseUrl;

    if (host.includes("github")) {
      return new GitHubRepositorySource(this.httpClient, {
        repositoryPath: input.project.repositoryPath,
        gitHost: input.project.gitHost,
        apiBaseUrl: baseUrl,
        token,
        defaultBranch: input.project.defaultBranch,
        maxRetryAfterMs: input.options?.maxRetryAfterMs,
        maxRateLimitRetries: input.options?.maxRateLimitRetries,
      });
    }

    // Default to GitLab REST v4 (supports gitlab.com and self-hosted GitLab instances)
    const resolvedBaseUrl =
      baseUrl?.trim() ||
      (() => {
        try {
          return new URL(input.project.repositoryUrl).origin;
        } catch {
          return `https://${input.project.gitHost}`;
        }
      })();

    return new GitLabRepositorySource(this.httpClient, {
      baseUrl: resolvedBaseUrl,
      projectPath: input.project.repositoryPath,
      token,
      defaultBranch: input.project.defaultBranch,
      maxRetryAfterMs: input.options?.maxRetryAfterMs,
      maxRateLimitRetries: input.options?.maxRateLimitRetries,
    });
  }

  /**
   * Starts an indexing job for a project, or returns the currently running job if one is already active.
   */
  async startJob(input: StartIndexJobInput): Promise<IndexJob> {
    const projectId = input.project.id;
    const key = String(projectId);
    const existing = this.activeJobs.get(key);
    if (
      existing &&
      (existing.job.status === "queued" || existing.job.status === "running")
    ) {
      return existing.job;
    }

    const jobId = `idx_${Date.now()}_${randomBytes(4).toString("hex")}`;
    const initialJob: IndexJob = {
      id: jobId,
      projectId,
      ...(input.ref !== undefined
        ? { ref: input.ref }
        : input.project.defaultBranch !== undefined
          ? { ref: input.project.defaultBranch }
          : {}),
      status: "queued",
      progress: {
        phase: "queued",
        done: 0,
        total: 1,
        message: "Job queued",
      },
      startedAt: new Date().toISOString(),
    };

    const controller = new AbortController();
    await this.store.saveJob(initialJob);

    const handle: ActiveJobHandle = {
      job: initialJob,
      controller,
      promise: Promise.resolve(initialJob),
    };
    this.activeJobs.set(key, handle);

    handle.promise = this.runJobInternal(handle, input);
    return handle.job;
  }

  private async runJobInternal(
    handle: ActiveJobHandle,
    input: StartIndexJobInput,
  ): Promise<IndexJob> {
    const projectId = input.project.id;
    const key = String(projectId);
    const secretTokens = [input.credentials?.token];

    const updateProgress = (progress: IndexJobProgress) => {
      if (handle.controller.signal.aborted) return;
      handle.job = {
        ...handle.job,
        status: "running",
        progress,
      };
      void this.store.saveJob(handle.job);
    };

    try {
      handle.job = {
        ...handle.job,
        status: "running",
        progress: {
          phase: "resolving_ref",
          done: 0,
          total: 1,
          message: "Starting repository indexing",
        },
      };
      await this.store.saveJob(handle.job);

      const source = this.createSourceForProject(input);
      const snapshot = await this.indexer.indexRepository(projectId, source, {
        ...input.options,
        ref: input.ref ?? input.project.defaultBranch,
        signal: handle.controller.signal,
        onProgress: updateProgress,
      });

      const completedJob: IndexJob = {
        ...handle.job,
        status: "succeeded",
        ref: snapshot.ref,
        commitSha: snapshot.commitSha,
        progress: {
          phase: "completed",
          done: snapshot.stats.indexedFilesCount,
          total: snapshot.stats.indexedFilesCount,
          message: `Indexed ${snapshot.stats.indexedFilesCount} files (${snapshot.stats.reusedFilesCount} reused)`,
        },
        finishedAt: new Date().toISOString(),
      };
      handle.job = completedJob;
      await this.store.saveJob(completedJob);
      return completedJob;
    } catch (err: unknown) {
      const isCancelled =
        handle.controller.signal.aborted ||
        (err instanceof Error && err.name === "AbortError");

      const rawMessage =
        err instanceof Error ? err.message : String(err ?? "Indexing failed");
      const safeError = redactSecrets(rawMessage, secretTokens);

      const terminalJob: IndexJob = {
        ...handle.job,
        status: isCancelled ? "cancelled" : "failed",
        progress: {
          ...handle.job.progress,
          message: isCancelled ? "Indexing cancelled by user" : safeError,
        },
        finishedAt: new Date().toISOString(),
        ...(isCancelled ? {} : { error: safeError }),
      };
      handle.job = terminalJob;
      await this.store.saveJob(terminalJob);
      return terminalJob;
    } finally {
      const current = this.activeJobs.get(key);
      if (current?.job.id === handle.job.id) {
        this.activeJobs.delete(key);
      }
    }
  }

  /**
   * Waits for an active job for `projectId` to reach a terminal state (useful in tests and CLI).
   */
  async waitForJob(projectId: ProjectId | string): Promise<IndexJob | undefined> {
    const key = String(projectId);
    const active = this.activeJobs.get(key);
    if (active) {
      return active.promise;
    }
    return this.store.getJob(projectId);
  }

  /**
   * Returns the current active or most recently persisted `IndexJob` for a project.
   */
  async getJobStatus(
    projectId: ProjectId | string,
  ): Promise<IndexJob | undefined> {
    const key = String(projectId);
    const active = this.activeJobs.get(key);
    if (active) {
      return active.job;
    }
    const persisted = await this.store.getJob(projectId);
    if (
      persisted &&
      (persisted.status === "queued" || persisted.status === "running")
    ) {
      // Interrupted job from a previous process lifecycle (non-resumable by design)
      const interrupted: IndexJob = {
        ...persisted,
        status: "failed",
        finishedAt: new Date().toISOString(),
        error: "Indexing job was interrupted by server restart",
      };
      await this.store.saveJob(interrupted);
      return interrupted;
    }
    return persisted;
  }

  /**
   * Cancels an active job for `projectId` if one is currently queued or running.
   */
  cancelJob(projectId: ProjectId | string): boolean {
    const key = String(projectId);
    const active = this.activeJobs.get(key);
    if (!active) return false;
    if (active.job.status !== "queued" && active.job.status !== "running") {
      return false;
    }
    active.controller.abort();
    return true;
  }
}
