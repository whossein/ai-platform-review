/**
 * Project rule-scan handlers (no AI): scan a chosen branch with the deterministic
 * rules and read back the report.
 *  - start/cancel a scan         -> `project:manage`
 *  - read status/report/history  -> `project:view`
 */

import type { SafeUser } from "@ai-review/core";
import type { ScanJobManager, ScanStore } from "../scan-manager.js";
import { providerForHost, requireProject, type IndexHandlerDeps } from "./index-handlers.js";

export interface ScanHandlerDeps extends IndexHandlerDeps {
  readonly scanStore: ScanStore;
  readonly scanJobs: ScanJobManager;
}

function httpError(status: number, message: string): Error {
  const err = new Error(message);
  (err as any).status = status;
  return err;
}

export async function startProjectScanHandler(
  deps: ScanHandlerDeps,
  projectId: string,
  user: SafeUser,
  body: { ref?: unknown },
  tokenOverride?: string,
) {
  const project = await requireProject(deps, projectId, user, "project:manage");
  const ref = typeof body?.ref === "string" && body.ref.trim() ? body.ref.trim() : undefined;
  if (ref !== undefined && (ref.length > 200 || /[\s\u0000-\u001f]/.test(ref))) {
    throw httpError(400, "Invalid ref");
  }
  const token =
    tokenOverride ||
    (await deps.security.credentialStore.getDecryptedToken(user.id, providerForHost(project.gitHost)));
  // Remote only: never scan a server-side local path through the API.
  const { localPath: _ignored, ...remoteProject } = project as typeof project & { localPath?: string };

  const job = await deps.scanJobs.startJob({
    project: remoteProject,
    ref,
    credentials: token ? { token } : undefined,
  });

  await deps.security.auditStore.log({
    actorUserId: user.id,
    actorName: user.name,
    actorEmail: user.email,
    action: "PROJECT_SCAN_STARTED",
    entityType: "project",
    entityId: project.id,
    metadata: { ref: ref ?? project.defaultBranch ?? "default", jobId: job.id },
  });
  return { job };
}

export async function cancelProjectScanHandler(deps: ScanHandlerDeps, projectId: string, user: SafeUser) {
  await requireProject(deps, projectId, user, "project:manage");
  return { cancelled: deps.scanJobs.cancelJob(projectId) };
}

export async function getProjectScanHandler(
  deps: ScanHandlerDeps,
  projectId: string,
  user: SafeUser,
  query: { ref?: unknown } = {},
) {
  await requireProject(deps, projectId, user, "project:view");
  const ref = typeof query.ref === "string" && query.ref.trim() ? query.ref.trim() : undefined;
  const [job, report, history] = await Promise.all([
    deps.scanJobs.getJobStatus(projectId),
    deps.scanStore.getReport(projectId, ref),
    deps.scanStore.getHistory(projectId),
  ]);
  return { job: job ?? null, report: report ?? null, history };
}
