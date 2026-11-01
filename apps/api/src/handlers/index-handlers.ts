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
) {
  const token = await deps.security.credentialStore.getDecryptedToken(
    user.id,
    providerForHost(project.gitHost),
  );

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

/**
 * Starts a background index job when a project has never been indexed or its
 * index is older than 24h. Never throws and never blocks the caller; a failed
 * attempt is not retried for 10 minutes.
 */
export async function ensureProjectIndexed(
  deps: IndexHandlerDeps,
  project: Project,
  user: SafeUser,
): Promise<void> {
  try {
    const now = Date.now();
    const pointer = await deps.indexStore.getLatestPointer(project.id);
    if (pointer && now - Date.parse(pointer.updatedAt) < AUTO_INDEX_MAX_AGE_MS) return;

    const job = await deps.indexJobs.getJobStatus(project.id);
    if (job?.status === "queued" || job?.status === "running") return;
    if (
      job?.status === "failed" &&
      job.finishedAt &&
      now - Date.parse(job.finishedAt) < AUTO_INDEX_RETRY_AFTER_FAILURE_MS
    ) {
      return;
    }

    await launchIndexJob(deps, project, user, undefined);
  } catch (err) {
    console.warn("Auto-index skipped:", err);
  }
}

/** Index-derived context for the files changed in a review, or undefined when unavailable. */
export async function buildProjectReviewContext(
  deps: IndexHandlerDeps,
  projectId: string,
  paths: readonly string[],
): Promise<string | undefined> {
  const snapshot = await deps.indexStore.getLatestSnapshot(projectId);
  if (!snapshot) return undefined;
  return buildReviewContext(snapshot, paths) || undefined;
}

export async function startProjectIndexHandler(
  deps: IndexHandlerDeps,
  projectId: string,
  user: SafeUser,
  body: { ref?: unknown },
) {
  const project = await requireProject(deps, projectId, user, "project:manage");

  const ref =
    typeof body?.ref === "string" && body.ref.trim() ? body.ref.trim() : undefined;
  if (ref !== undefined && (ref.length > 200 || /[\s\u0000-\u001f]/.test(ref))) {
    throw httpError(400, "Invalid ref");
  }

  const job = await launchIndexJob(deps, project, user, ref);

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

export async function cancelProjectIndexHandler(
  deps: IndexHandlerDeps,
  projectId: string,
  user: SafeUser,
) {
  await requireProject(deps, projectId, user, "project:manage");
  const cancelled = deps.indexJobs.cancelJob(projectId);
  return { cancelled };
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
