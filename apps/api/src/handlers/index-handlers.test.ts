import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { SafeUser } from "@ai-review/core";
import { ProjectIndexStore, IndexJobManager } from "@ai-review/project-index";
import type { HttpClient } from "@ai-review/git";
import { ProjectStore } from "../project-store.js";
import { SecurityContext } from "../security/index.js";
import {
  startProjectIndexHandler,
  cancelProjectIndexHandler,
  getProjectIndexHandler,
  ensureProjectIndexed,
  getProjectIndexHistoryHandler,
  buildProjectReviewContext,
  listProjectBranchesHandler,
  type IndexHandlerDeps,
} from "./index-handlers.js";

const SECRET = "glpat-supersecrettoken123";

/** The head SHA cache is per-process; tests wait it out by moving its clock. */
function headCacheBust() {
  vi.setSystemTime(Date.now() + 2 * 60 * 1000);
}

function snapshotFor(projectId: string, ref: string, shaChar: string, exportName: string) {
  return {
    schemaVersion: 1 as const,
    projectId: projectId as never,
    ref,
    commitSha: shaChar.repeat(40),
    createdAt: new Date().toISOString(),
    stats: {} as never,
    files: [
      { path: "src/a.ts", lang: "ts" as const, size: 1, lineCount: 1, contentHash: "h", symbols: [], imports: [], exports: [exportName] },
      { path: "src/b.ts", lang: "ts" as const, size: 1, lineCount: 1, contentHash: "h", symbols: [], imports: [], exports: [] },
    ],
    graph: {
      importsByFile: { "src/b.ts": ["src/a.ts"] },
      importedByFile: { "src/a.ts": ["src/b.ts"] },
      externalImportsByFile: {},
      workspaces: [],
      pathAliases: {},
    },
  };
}

describe("project index handlers", () => {
  let dir: string;
  let deps: IndexHandlerDeps;
  let projectId: string;
  let owner: SafeUser;
  let outsider: SafeUser;
  let seenAuthHeaders: string[];

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-review-index-api-"));
    seenAuthHeaders = [];
    const failingHttp: HttpClient = {
      async send(req) {
        seenAuthHeaders.push(JSON.stringify(req.headers ?? {}));
        return {
          ok: false,
          error: {
            category: "provider",
            code: "boom",
            message: `request failed for token ${SECRET}`,
          },
        } as never;
      },
    };
    const security = new SecurityContext(dir);
    const projectStore = new ProjectStore(dir);
    const indexStore = new ProjectIndexStore(path.join(dir, "index"));
    deps = {
      projectStore,
      security,
      indexStore,
      indexJobs: new IndexJobManager(indexStore, failingHttp),
    };

    owner = await security.userStore.createUser({
      name: "Owner",
      email: "owner@example.com",
      password: "OwnerPass123!",
      role: "MEMBER",
    });
    outsider = await security.userStore.createUser({
      name: "Outsider",
      email: "out@example.com",
      password: "OutsiderPass123!",
      role: "MEMBER",
    });
    const project = await projectStore.createProject({
      repositoryUrl: "https://gitlab.example.com/team/app",
    });
    projectId = project.id;
    await security.memberStore.addMember(project.id, owner.id, "OWNER");
    await security.credentialStore.setCredential(owner.id, "gitlab", SECRET);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("denies non-members on every operation", async () => {
    await expect(getProjectIndexHandler(deps, projectId, outsider)).rejects.toMatchObject({ status: 403 });
    await expect(startProjectIndexHandler(deps, projectId, outsider, {})).rejects.toMatchObject({ status: 403 });
    await expect(cancelProjectIndexHandler(deps, projectId, outsider)).rejects.toMatchObject({ status: 403 });
  });

  it("rejects malformed refs and unknown projects", async () => {
    await expect(
      startProjectIndexHandler(deps, projectId, owner, { ref: "main branch" }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      getProjectIndexHandler(deps, "proj_missing", owner),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("returns an empty index before any job has run", async () => {
    expect(await getProjectIndexHandler(deps, projectId, owner)).toEqual({ job: null, index: null });
  });

  it("starts a job with the user's token and never leaks it in job state", async () => {
    const { job } = await startProjectIndexHandler(deps, projectId, owner, {});
    expect(["queued", "running", "failed"]).toContain(job.status);

    const final = await deps.indexJobs.waitForJob(projectId);
    expect(final?.status).toBe("failed");
    expect(JSON.stringify(final)).not.toContain(SECRET);
    expect(seenAuthHeaders.join("")).toContain(SECRET);

    const status = await getProjectIndexHandler(deps, projectId, owner);
    expect(status.job?.status).toBe("failed");
    expect(JSON.stringify(status)).not.toContain(SECRET);
  });

  it("records an audit entry when indexing starts", async () => {
    await startProjectIndexHandler(deps, projectId, owner, {});
    await deps.indexJobs.waitForJob(projectId);
    const { logs } = await deps.security.auditStore.query({ action: "PROJECT_INDEX_STARTED" } as never);
    expect(logs.length).toBe(1);
  });

  it("auto-index starts once for an unindexed project and is a no-op while a job is active", async () => {
    const { project } = (await deps.projectStore.getProject(projectId))!;
    await ensureProjectIndexed(deps, project, owner);
    const first = await deps.indexJobs.getJobStatus(projectId);
    expect(first).toBeDefined();
    await ensureProjectIndexed(deps, project, owner);
    const second = await deps.indexJobs.getJobStatus(projectId);
    expect(second?.id).toBe(first?.id);
    await deps.indexJobs.waitForJob(projectId);
  });

  it("auto-index backs off after a recent failure", async () => {
    const { project } = (await deps.projectStore.getProject(projectId))!;
    await ensureProjectIndexed(deps, project, owner);
    const failed = await deps.indexJobs.waitForJob(projectId);
    expect(failed?.status).toBe("failed");
    await ensureProjectIndexed(deps, project, owner);
    expect((await deps.indexJobs.getJobStatus(projectId))?.id).toBe(failed?.id);
  });

  it("builds review context only when a snapshot exists", async () => {
    const { project } = (await deps.projectStore.getProject(projectId))!;
    expect(await buildProjectReviewContext(deps, project, owner, ["src/a.ts"])).toBeUndefined();
    await deps.indexStore.saveSnapshot(snapshotFor(projectId, "main", "b", "a"));
    const ctx = await buildProjectReviewContext(deps, project, owner, ["src/a.ts"]);
    expect(ctx).toContain("src/a.ts: exports a; imported by 1 file(s): src/b.ts");
  });

  it("uses the index of the MR target branch, not whichever branch was indexed last", async () => {
    const { project } = (await deps.projectStore.getProject(projectId))!;
    await deps.indexStore.saveSnapshot(snapshotFor(projectId, "main", "b", "fromMain"));
    await deps.indexStore.saveSnapshot(snapshotFor(projectId, "feature-x", "c", "fromFeature"));

    const forMain = await buildProjectReviewContext(deps, project, owner, ["src/a.ts"], { ref: "main" });
    expect(forMain).toContain("exports fromMain");
    expect(forMain).toContain("index of main@");

    // unknown target branch falls back to the latest index rather than failing
    const fallback = await buildProjectReviewContext(deps, project, owner, ["src/a.ts"], { ref: "release" });
    expect(fallback).toContain("exports fromFeature");
  });

  it("re-indexes only when the branch head moved, and not more often than every 5 minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { project } = (await deps.projectStore.getProject(projectId))!;
    const started: Array<string | undefined> = [];
    let head = "b".repeat(40);
    const stubJobs = {
      resolveHead: async () => ({ ref: "main", commitSha: head }),
      getJobStatus: async () => undefined,
      startJob: async (input: { ref?: string }) => {
        started.push(input.ref);
        return { id: "j" } as never;
      },
    };
    const stubDeps = { ...deps, indexJobs: stubJobs as never };
    const old = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await deps.indexStore.saveSnapshot({ ...snapshotFor(projectId, "main", "b", "x"), createdAt: old });

    await ensureProjectIndexed(stubDeps, project, owner, { ref: "main" });
    expect(started).toEqual([]); // head unchanged: stays fresh

    head = "c".repeat(40);
    headCacheBust();
    await ensureProjectIndexed(stubDeps, project, owner, { ref: "main" });
    expect(started).toEqual(["main"]); // head moved: re-indexed

    await deps.indexStore.saveSnapshot(snapshotFor(projectId, "main", "c", "x")); // just indexed
    head = "d".repeat(40);
    headCacheBust();
    await ensureProjectIndexed(stubDeps, project, owner, { ref: "main" });
    expect(started).toEqual(["main"]); // too soon to rebuild again
    vi.useRealTimers();
  });

  it("keeps a history of finished jobs, newest first, visible to viewers only", async () => {
    await startProjectIndexHandler(deps, projectId, owner, {});
    await deps.indexJobs.waitForJob(projectId);
    await startProjectIndexHandler(deps, projectId, owner, { ref: "main" });
    const last = await deps.indexJobs.waitForJob(projectId);

    const { history } = await getProjectIndexHistoryHandler(deps, projectId, owner);
    expect(history).toHaveLength(2);
    expect(history[0]!.id).toBe(last!.id);
    expect(history[0]!.status).toBe("failed");
    expect(JSON.stringify(history)).not.toContain(SECRET);
    await expect(getProjectIndexHistoryHandler(deps, projectId, outsider)).rejects.toMatchObject({ status: 403 });
  });

  it("caps history at 50 entries", async () => {
    for (let i = 0; i < 55; i++) {
      await deps.indexStore.appendHistory({
        id: `j${i}`,
        projectId: projectId as never,
        status: "succeeded",
        progress: { phase: "completed", done: 1, total: 1 },
        startedAt: new Date(i * 1000).toISOString(),
      });
    }
    const history = await deps.indexStore.getHistory(projectId);
    expect(history).toHaveLength(50);
    expect(history[0]!.id).toBe("j54");
  });

  it("keeps one snapshot per branch through pruning", async () => {
    for (const [ref, ch] of [["a", "1"], ["b", "2"], ["c", "3"], ["d", "4"], ["e", "5"]] as const) {
      await deps.indexStore.saveSnapshot(snapshotFor(projectId, ref, ch, ref));
    }
    for (const ref of ["a", "b", "c", "d", "e"]) {
      expect(await deps.indexStore.getSnapshotForRef(projectId, ref)).toBeDefined();
    }
  });

  it("branch listing is manage-only and reports host errors without leaking the token", async () => {
    await expect(listProjectBranchesHandler(deps, projectId, outsider)).rejects.toMatchObject({ status: 403 });
    const err = await listProjectBranchesHandler(deps, projectId, owner).catch((e) => e);
    expect(err.status).toBe(502);
    expect(String(err.message)).not.toContain(SECRET);
  });
});
