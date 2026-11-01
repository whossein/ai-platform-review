import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
  type IndexHandlerDeps,
} from "./index-handlers.js";

const SECRET = "glpat-supersecrettoken123";

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
});
