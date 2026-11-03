import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { ProjectStore } from "./project-store.js";

describe("ProjectStore & Registry", () => {
  let tmpDir: string;
  let store: ProjectStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "project-store-test-"));
    store = new ProjectStore(tmpDir);
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("manually creates a Project with normalized gitHost, repositoryPath, namespace", async () => {
    const project = await store.createProject({
      name: "Custom PWA",
      repositoryUrl: "https://gitlab.company.com/frontend/storefront-pwa",
    });

    expect(project.id).toMatch(/^proj_/);
    expect(project.name).toBe("Custom PWA");
    expect(project.gitHost).toBe("gitlab.company.com");
    expect(project.repositoryPath).toBe("frontend/storefront-pwa");
    expect(project.namespace).toBe("frontend");
    expect(project.repositoryUrl).toBe("https://gitlab.company.com/frontend/storefront-pwa");

    const list = await store.listProjects();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(project.id);
  });

  it("prevents creating duplicate projects for the same repository", async () => {
    await store.createProject({
      repositoryUrl: "https://gitlab.company.com/frontend/storefront-pwa",
    });

    // Attempt duplicate with trailing slash, .git, and different project name
    await expect(
      store.createProject({
        name: "Different Display Name",
        repositoryUrl: "https://gitlab.company.com/frontend/storefront-pwa.git/",
      }),
    ).rejects.toThrow(/already exists/i);
  });

  it("considers same repo paths on DIFFERENT git hosts as distinct projects", async () => {
    const projA = await store.createProject({
      repositoryUrl: "https://git.company-a.com/team/my-app",
    });
    const projB = await store.createProject({
      repositoryUrl: "https://git.company-b.com/team/my-app",
    });

    expect(projA.id).not.toBe(projB.id);
    expect(projA.gitHost).toBe("git.company-a.com");
    expect(projB.gitHost).toBe("git.company-b.com");

    const list = await store.listProjects();
    expect(list).toHaveLength(2);
  });

  it("automatically creates a Project and MR when MR URL is submitted", async () => {
    const mrUrl =
      "https://gitlab.company.com/frontend/storefront-pwa/-/merge_requests/123";

    const { project, mergeRequest, created } =
      await store.findOrCreateFromUrl(mrUrl);

    expect(created).toBe(true);
    expect(project.name).toBe("storefront-pwa");
    expect(project.gitHost).toBe("gitlab.company.com");
    expect(project.repositoryPath).toBe("frontend/storefront-pwa");
    expect(project.namespace).toBe("frontend");
    expect(mergeRequest).toBeDefined();
    expect(mergeRequest?.mrNumber).toBe("123");
    expect(mergeRequest?.projectId).toBe(project.id);
  });

  it("does NOT duplicate project when another MR from the same repository is submitted", async () => {
    const mr1 =
      "https://gitlab.company.com/frontend/storefront-pwa/-/merge_requests/123";
    const mr2 =
      "https://gitlab.company.com/frontend/storefront-pwa/-/merge_requests/456";

    const res1 = await store.findOrCreateFromUrl(mr1);
    expect(res1.created).toBe(true);

    const res2 = await store.findOrCreateFromUrl(mr2);
    expect(res2.created).toBe(false);
    expect(res2.project.id).toBe(res1.project.id);
    expect(res2.mergeRequest?.mrNumber).toBe("456");
    expect(res2.mergeRequest?.projectId).toBe(res1.project.id);

    // Verify Project details contains both MRs
    const details = await store.getProject(res1.project.id);
    expect(details).toBeDefined();
    expect(details?.mergeRequests).toHaveLength(2);
    const mrNumbers = details?.mergeRequests.map((m) => m.mrNumber);
    expect(mrNumbers).toContain("123");
    expect(mrNumbers).toContain("456");
  });

  it("associates reviews with the Project and MergeRequest", async () => {
    const mrUrl =
      "https://gitlab.company.com/frontend/storefront-pwa/-/merge_requests/123";
    const { project, mergeRequest } = await store.findOrCreateFromUrl(mrUrl);

    const review = await store.recordReview({
      projectId: project.id,
      mergeRequestId: mergeRequest?.id,
      target: mrUrl,
      model: "gemini-2.0-flash",
      result: {
        accepted: 2,
        total: 2,
        issues: [
          { severity: "high", accepted: true },
          { severity: "medium", accepted: true },
        ],
      },
    });

    expect(review.projectId).toBe(project.id);
    expect(review.mergeRequestId).toBe(mergeRequest?.id);

    const details = await store.getProject(project.id);
    expect(details?.reviews).toHaveLength(1);
    expect(details?.stats.reviewCount).toBe(1);
    expect(details?.stats.averageScore).toBeDefined();
  });

  it("creates and updates custom instructions and description for a project", async () => {
    const project = await store.createProject({
      name: "Core Backend",
      repositoryUrl: "https://gitlab.company.com/backend/core-api",
      description: "Main backend API service",
      customInstructions: "Enforce strict Persian error messages and OWASP security rules.",
    });

    expect(project.description).toBe("Main backend API service");
    expect(project.customInstructions).toBe(
      "Enforce strict Persian error messages and OWASP security rules.",
    );

    const updated = await store.updateProject(project.id, {
      name: "Core Backend V2",
      description: "Updated description",
      customInstructions: "New AI guidelines: Always check database indices.",
    });

    expect(updated.name).toBe("Core Backend V2");
    expect(updated.description).toBe("Updated description");
    expect(updated.customInstructions).toBe(
      "New AI guidelines: Always check database indices.",
    );

    const reloaded = await store.getProject(project.id);
    expect(reloaded?.project.name).toBe("Core Backend V2");
    expect(reloaded?.project.customInstructions).toBe(
      "New AI guidelines: Always check database indices.",
    );
  });

  it("suggests a grade on review, stores author meta and keeps the reviewer grade", async () => {
    const { project, mergeRequest } = await store.findOrCreateFromUrl(
      "https://gitlab.company.com/team/app/-/merge_requests/5",
    );
    const mr = mergeRequest!;

    await store.recordReview({
      projectId: project.id,
      mergeRequestId: mr.id,
      target: mr.url,
      result: { issues: [{ severity: "high", accepted: true }] },
    });
    await store.setMergeRequestMeta(project.id, mr.id, {
      title: "Add login",
      author: { username: "Ali", name: "Ali R" },
    });
    await store.gradeMergeRequest(project.id, mr.id, {
      score: 9,
      note: "good",
      gradedById: "u1",
      gradedByName: "Sara",
      gradedAt: new Date().toISOString() as any,
    });

    const details = await store.getProject(project.id);
    const saved = details!.mergeRequests[0]!;
    expect(saved.suggestedGrade?.score).toBe(9);
    expect(saved.suggestedGrade?.reason).toContain("1 high");
    expect(saved.grade?.score).toBe(9);
    expect(saved.author?.username).toBe("Ali");

    const devs = await store.listDevelopers(project.id);
    expect(devs).toHaveLength(1);
    expect(devs[0]?.averageGrade).toBe(9);

    await store.gradeMergeRequest(project.id, mr.id, null);
    expect((await store.getProject(project.id))!.mergeRequests[0]!.grade).toBeUndefined();
  });
});
