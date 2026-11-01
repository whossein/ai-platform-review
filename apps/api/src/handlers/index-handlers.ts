/**
 * Project Index Route Handlers.
 *
 * Exposes `@ai-review/project-index` (structural repository indexing) through
 * authenticated, RBAC-protected operations:
 *  - start/cancel an index job           -> `project:manage`
 *  - read job status and index summary   -> `project:view`
 *
 * Only remote (GitHub/GitLab) repositories are indexed through the API. Local
 * checkouts are never read from request input, so a caller cannot make the
 * server walk arbitrary filesystem paths.
 */

import type { Project, ProjectId, SafeUser, GitCredentialProvider } from "@ai-review/core";
import { buildReviewContext } from "@ai-review/project-index";
import type { IndexJobManager, ProjectIndexStore } from "@ai-review/project-index";
import type { ProjectStore } from "../project-store.js";
import type { SecurityContext } from "../security/security-context.js";

export interface IndexHandlerDeps {
  readonly projectStore: ProjectStore;
  readonly security: SecurityContext;
  readonly indexStore: ProjectIndexStore;
  readonly indexJobs: IndexJobManager;
}

const TOP_FILES_LIMIT = 10;

function httpError(status: number, message: string): Error {
  const err = new Error(message);
  (err as any).status = status;
  return err;
}

async function requireProject(
  deps: IndexHandlerDeps,
  projectId: string,
  user: SafeUser,
  permission: "project:view" | "project:manage",
) {
  const allowed = await deps.security.canAccessProject(
    user,
    projectId as ProjectId,
    permission,
  );
  if (!allowed) {
    throw httpError(403, "Access denied: You do not have permission for this project index.");
  }
  const details = await deps.projectStore.getProject(projectId);
  if (!details) {
    throw httpError(404, `Project with ID "${projectId}" not found`);
  }
  return details.project;
}

function providerForHost(gitHost: string): GitCredentialProvider {
  return gitHost.toLowerCase().includes("github") ? "github" : "gitlab";
}

async function launchIndexJob(
  deps: IndexHandlerDeps,
  project: Project,
  user: SafeUser,
  ref: string | undefined,
  tokenOverride?: string,
) {
  const token =
    tokenOverride ||
    (await deps.security.credentialStore.getDecryptedToken(
      user.id,
      providerForHost(project.gitHost),
    ));

  // Never index local paths through the API: strip any localPath from the project.
  const { localPath: _ignored, ...remoteProject } = project as typeof project & {
    localPath?: string;
  };

  return deps.indexJobs.startJob({
    project: remoteProject,
    ref,
    credentials: token ? { token } : undefined,
  });
}

const AUTO_INDEX_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const AUTO_INDEX_RETRY_AFTER_FAILURE_MS = 10 * 60 * 1000;
const DEFAULT_BRANCH_TTL_MS = 60 * 60 * 1000;
/** An existing index is not re-checked/rebuilt more often than this, even on a busy branch. */
const MIN_REINDEX_INTERVAL_MS = 5 * 60 * 1000;
const HEAD_CACHE_TTL_MS = 60 * 1000;

const headCache = new Map<string, { sha: string; at: number }>();

const defaultBranchCache = new Map<string, { branch: string; at: number }>();

async function resolveToken(
  deps: IndexHandlerDeps,
  project: Project,
  user: SafeUser,
  tokenOverride?: string,
): Promise<string | undefined> {
  return (
    tokenOverride ||
    (await deps.security.credentialStore.getDecryptedToken(
      user.id,
      providerForHost(project.gitHost),
    )) ||
    undefined
  );
}

/** Default branch of the project (cached for an hour); undefined when it cannot be determined. */
async function resolveDefaultBranch(
  deps: IndexHandlerDeps,
  project: Project,
  user: SafeUser,
  tokenOverride?: string,
): Promise<string | undefined> {
  if (project.defaultBranch) return project.defaultBranch;
  const cached = defaultBranchCache.get(project.id);
  if (cached && Date.now() - cached.at < DEFAULT_BRANCH_TTL_MS) return cached.branch;
  try {
    const token = await resolveToken(deps, project, user, tokenOverride);
    const { localPath: _ignored, ...remoteProject } = project as typeof project & {
      localPath?: string;
    };
    const { defaultBranch } = await deps.indexJobs.listBranches({
      project: remoteProject,
      credentials: token ? { token } : undefined,
    });
    if (defaultBranch) {
      defaultBranchCache.set(project.id, { branch: defaultBranch, at: Date.now() });
      return defaultBranch;
    }
  } catch {
    // fall through: caller falls back to the latest index
  }
  return undefined;
}

export interface EnsureIndexOptions {
  /** Branch to keep indexed (the MR's target branch); defaults to the project's default branch. */
  readonly ref?: string | undefined;
  /** Git token supplied with the request (e.g. from the user's Settings). */
  readonly tokenOverride?: string | undefined;
  /** The unified diff under review; overlaid on the index so new/moved/deleted files are covered. */
  readonly diff?: string | undefined;
}

/** Current head SHA of `ref` on the git host (cached briefly), or undefined if it cannot be read. */
async function currentHeadSha(
  deps: IndexHandlerDeps,
  project: Project,
  user: SafeUser,
  ref: string,
  tokenOverride?: string,
): Promise<string | undefined> {
  const key = `${project.id}:${ref}`;
  const cached = headCache.get(key);
  if (cached && Date.now() - cached.at < HEAD_CACHE_TTL_MS) return cached.sha;
  try {
    const token = await resolveToken(deps, project, user, tokenOverride);
    const { localPath: _ignored, ...remoteProject } = project as typeof project & {
      localPath?: string;
    };
    const head = await deps.indexJobs.resolveHead(
      { project: remoteProject, credentials: token ? { token } : undefined },
      ref,
    );
    headCache.set(key, { sha: head.commitSha, at: Date.now() });
    return head.commitSha;
  } catch {
    return undefined;
  }
}

/**
 * Starts a background index job when the wanted branch has never been indexed
 * or has moved on since it was indexed (its head SHA differs from the snapshot's;
 * if the head cannot be read, an index older than 24h counts as stale). A branch
 * is not rebuilt more often than every 5 minutes. Never throws and never blocks
 * the caller; a failed attempt is not retried for 10 minutes.
 */
export async function ensureProjectIndexed(
  deps: IndexHandlerDeps,
  project: Project,
  user: SafeUser,
  options: EnsureIndexOptions = {},
): Promise<void> {
  try {
    const now = Date.now();
    const ref =
      options.ref ?? (await resolveDefaultBranch(deps, project, user, options.tokenOverride));
    const pointer = ref
      ? await deps.indexStore.getRefPointer(project.id, ref)
      : await deps.indexStore.getLatestPointer(project.id);
    if (pointer) {
      const age = now - Date.parse(pointer.updatedAt);
      if (age < MIN_REINDEX_INTERVAL_MS) return;
      const head = ref
        ? await currentHeadSha(deps, project, user, ref, options.tokenOverride)
        : undefined;
      if (head ? head === pointer.commitSha : age < AUTO_INDEX_MAX_AGE_MS) return;
    }

    const job = await deps.indexJobs.getJobStatus(project.id);
    if (job?.status === "queued" || job?.status === "running") return;
    if (
      job?.status === "failed" &&
      job.finishedAt &&
      now - Date.parse(job.finishedAt) < AUTO_INDEX_RETRY_AFTER_FAILURE_MS
    ) {
      return;
    }

    await launchIndexJob(deps, project, user, ref, options.tokenOverride);
  } catch (err) {
    console.warn("Auto-index skipped:", err);
  }
}

/**
 * Index-derived context for the files changed in a review, or undefined when
 * unavailable. Prefers the index of the change's target branch, then the
 * project's default branch, then whatever was indexed last.
 */
export async function buildProjectReviewContext(
  deps: IndexHandlerDeps,
  project: Project,
  user: SafeUser,
  paths: readonly string[],
  options: EnsureIndexOptions = {},
): Promise<string | undefined> {
  let snapshot = options.ref
    ? await deps.indexStore.getSnapshotForRef(project.id, options.ref)
    : undefined;
  if (!snapshot) {
    const def = await resolveDefaultBranch(deps, project, user, options.tokenOverride);
    if (def) snapshot = await deps.indexStore.getSnapshotForRef(project.id, def);
  }
  snapshot ??= await deps.indexStore.getLatestSnapshot(project.id);
  if (!snapshot) return undefined;
  return buildReviewContext(snapshot, paths, { diff: options.diff }) || undefined;
}

export async function startProjectIndexHandler(
  deps: IndexHandlerDeps,
  projectId: string,
  user: SafeUser,
  body: { ref?: unknown },
  tokenOverride?: string,
) {
  const project = await requireProject(deps, projectId, user, "project:manage");

  const ref =
    typeof body?.ref === "string" && body.ref.trim() ? body.ref.trim() : undefined;
  if (ref !== undefined && (ref.length > 200 || /[\s\u0000-\u001f]/.test(ref))) {
    throw httpError(400, "Invalid ref");
  }

  const job = await launchIndexJob(deps, project, user, ref, tokenOverride);

  await deps.security.auditStore.log({
    actorUserId: user.id,
    actorName: user.name,
    actorEmail: user.email,
    action: "PROJECT_INDEX_STARTED",
    entityType: "project",
    entityId: project.id,
    metadata: { ref: ref ?? project.defaultBranch ?? "default", jobId: job.id },
  });

  return { job };
}

export async function listProjectBranchesHandler(
  deps: IndexHandlerDeps,
  projectId: string,
  user: SafeUser,
  tokenOverride?: string,
) {
  const project = await requireProject(deps, projectId, user, "project:manage");
  const token =
    tokenOverride ||
    (await deps.security.credentialStore.getDecryptedToken(
      user.id,
      providerForHost(project.gitHost),
    ));
  const { localPath: _ignored, ...remoteProject } = project as typeof project & {
    localPath?: string;
  };
  try {
    return await deps.indexJobs.listBranches({
      project: remoteProject,
      credentials: token ? { token } : undefined,
    });
  } catch (err) {
    // Token-scrubbed message from the source; surface as a gateway-style error
    throw httpError(502, err instanceof Error ? err.message : "Failed to list branches");
  }
}

export async function cancelProjectIndexHandler(
  deps: IndexHandlerDeps,
  projectId: string,
  user: SafeUser,
) {
  await requireProject(deps, projectId, user, "project:manage");
  const cancelled = deps.indexJobs.cancelJob(projectId);
  return { cancelled };
}

export async function getProjectIndexHistoryHandler(
  deps: IndexHandlerDeps,
  projectId: string,
  user: SafeUser,
) {
  await requireProject(deps, projectId, user, "project:view");
  return { history: await deps.indexStore.getHistory(projectId) };
}

export async function getProjectIndexHandler(
  deps: IndexHandlerDeps,
  projectId: string,
  user: SafeUser,
) {
  await requireProject(deps, projectId, user, "project:view");

  const job = (await deps.indexJobs.getJobStatus(projectId)) ?? null;
  const snapshot = await deps.indexStore.getLatestSnapshot(projectId);
  if (!snapshot) {
    return { job, index: null };
  }

  const topImportedFiles = Object.entries(snapshot.graph.importedByFile)
    .map(([file, importers]) => ({ file, importedByCount: importers.length }))
    .filter((f) => f.importedByCount > 0)
    .sort(
      (a, b) =>
        b.importedByCount - a.importedByCount || (a.file < b.file ? -1 : 1),
    )
    .slice(0, TOP_FILES_LIMIT);

  return {
    job,
    index: {
      ref: snapshot.ref,
      commitSha: snapshot.commitSha,
      createdAt: snapshot.createdAt,
      stats: snapshot.stats,
      workspaces: snapshot.graph.workspaces,
      pathAliases: snapshot.graph.pathAliases,
      topImportedFiles,
    },
  };
}
