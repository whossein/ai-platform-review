import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AsyncResult, Project, ProjectId } from "@ai-review/core";
import type { HttpClient, HttpRequest, HttpResponse } from "@ai-review/git";
import {
  DEFAULT_MAX_FILE_SIZE_BYTES,
  GitHubRepositorySource,
  GitLabRepositorySource,
  IndexJobManager,
  LocalRepositorySource,
  PathFilter,
  ProjectIndexStore,
  ProjectIndexer,
  detectLanguage,
  isBinaryContent,
  redactSecrets,
} from "./index.js";

class MockHttpClient implements HttpClient {
  readonly requests: HttpRequest[] = [];
  constructor(
    private readonly handler: (
      req: HttpRequest,
      callIndex: number,
    ) => Promise<HttpResponse> | HttpResponse,
  ) {}

  async send(req: HttpRequest): AsyncResult<HttpResponse> {
    const idx = this.requests.length;
    this.requests.push(req);
    try {
      const res = await this.handler(req, idx);
      return { ok: true, value: res };
    } catch (err) {
      return {
        ok: false,
        error: {
          category: "provider",
          code: "http.mock_error",
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }
}

function makeProject(overrides?: Partial<Project>): Project {
  const now = new Date().toISOString() as Project["createdAt"];
  return {
    id: "proj_test_1" as ProjectId,
    name: "platform-monorepo",
    repositoryUrl: "https://gitlab.example.com/eng/platform-monorepo",
    gitHost: "gitlab.example.com",
    repositoryPath: "eng/platform-monorepo",
    namespace: "eng",
    defaultBranch: "main",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("@ai-review/project-index (Sub-Phase 2A)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-review-idx-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("1. PathFilter, binary detection, size limits, and language detection", () => {
    it("excludes node_modules, dist, build, lockfiles, vendored, generated, and binary files", () => {
      const filter = new PathFilter({
        extraIgnorePatterns: ["custom_ignored/**", "*.secret.json"],
      });

      expect(filter.shouldExcludePath("node_modules/react/index.js")).toBe(true);
      expect(filter.shouldExcludePath("packages/web/node_modules/pkg/a.ts")).toBe(true);
      expect(filter.shouldExcludePath("dist/server.cjs")).toBe(true);
      expect(filter.shouldExcludePath("apps/web/build/main.js")).toBe(true);
      expect(filter.shouldExcludePath("package-lock.json")).toBe(true);
      expect(filter.shouldExcludePath("pnpm-lock.yaml")).toBe(true);
      expect(filter.shouldExcludePath("yarn.lock")).toBe(true);
      expect(filter.shouldExcludePath("Cargo.lock")).toBe(true);
      expect(filter.shouldExcludePath("go.sum")).toBe(true);
      expect(filter.shouldExcludePath("vendor/autoload.php")).toBe(true);
      expect(filter.shouldExcludePath("src/api/service.pb.go")).toBe(true);
      expect(filter.shouldExcludePath("src/schema.generated.ts")).toBe(true);
      expect(filter.shouldExcludePath("public/app.min.js")).toBe(true);
      expect(filter.shouldExcludePath("assets/logo.png")).toBe(true);
      expect(filter.shouldExcludePath("custom_ignored/file.ts")).toBe(true);
      expect(filter.shouldExcludePath("config/prod.secret.json")).toBe(true);

      // Valid source files are allowed
      expect(filter.shouldExcludePath("packages/core/src/index.ts")).toBe(false);
      expect(filter.shouldExcludePath("apps/web/src/App.tsx")).toBe(false);
      expect(filter.shouldExcludePath("scripts/analyze.py")).toBe(false);
    });

    it("enforces maxFileSizeBytes and detects NUL-byte binary content", () => {
      const filter = new PathFilter({ maxFileSizeBytes: 1024 });
      expect(filter.isAllowedSize(512)).toBe(true);
      expect(filter.isAllowedSize(1024)).toBe(true);
      expect(filter.isAllowedSize(1025)).toBe(false);
      expect(DEFAULT_MAX_FILE_SIZE_BYTES).toBe(262_144);

      expect(isBinaryContent("export const x = 42;\n")).toBe(false);
      expect(isBinaryContent("ELF\u0000binary_payload")).toBe(true);
    });

    it("detects programming languages accurately by extension", () => {
      expect(detectLanguage("src/index.ts")).toBe("ts");
      expect(detectLanguage("src/Component.tsx")).toBe("tsx");
      expect(detectLanguage("src/utils.mjs")).toBe("js");
      expect(detectLanguage("src/View.jsx")).toBe("jsx");
      expect(detectLanguage("ml/train.py")).toBe("py");
      expect(detectLanguage("cmd/server/main.go")).toBe("go");
      expect(detectLanguage("src/lib.rs")).toBe("rs");
      expect(detectLanguage("README.md")).toBe("md");
      expect(detectLanguage("Dockerfile")).toBe("other");
    });
  });

  describe("2. LocalRepositorySource, AST extraction, workspaces, and import graph", () => {
    it("indexes a local monorepo fixture, extracts TS/TSX AST, stores metadata-only for Python, and builds accurate import/reverse graphs", async () => {
      const repoDir = path.join(tempDir, "fixture-repo");
      const storeDir = path.join(tempDir, "index-store");
      const commitSha = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

      // Create simulated .git directory
      await fs.mkdir(path.join(repoDir, ".git/refs/heads"), { recursive: true });
      await fs.writeFile(path.join(repoDir, ".git/HEAD"), "ref: refs/heads/main\n");
      await fs.writeFile(
        path.join(repoDir, ".git/refs/heads/main"),
        `${commitSha}\n`,
      );

      // Root .gitignore, package.json (workspaces), and tsconfig.base.json (paths)
      await fs.writeFile(
        path.join(repoDir, ".gitignore"),
        "ignored_dir/\n*.tmp.ts\n",
      );
      await fs.writeFile(
        path.join(repoDir, "package.json"),
        JSON.stringify(
          {
            name: "fixture-root",
            private: true,
            workspaces: ["packages/*"],
          },
          null,
          2,
        ),
      );
      await fs.writeFile(
        path.join(repoDir, "tsconfig.base.json"),
        `{
          // JSONC comment in tsconfig
          "compilerOptions": {
            "baseUrl": ".",
            "paths": {
              "@shared/*": ["packages/shared/src/*"]
            }
          }
        }`,
      );

      // Package 1: @fixture/core
      await fs.mkdir(path.join(repoDir, "packages/core/src"), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(repoDir, "packages/core/package.json"),
        JSON.stringify({
          name: "@fixture/core",
          main: "./src/index.ts",
        }),
      );
      await fs.writeFile(
        path.join(repoDir, "packages/core/src/math.ts"),
        `export function calculateTotal(items: number[]): number {\n  return items.reduce((a, b) => a + b, 0);\n}\n`,
      );
      await fs.writeFile(
        path.join(repoDir, "packages/core/src/index.ts"),
        `import { calculateTotal } from "./math.js";\nexport { calculateTotal };\nexport interface OrderSummary {\n  readonly total: number;\n}\n`,
      );

      // Package 2: @fixture/shared (resolved via tsconfig path alias @shared/*)
      await fs.mkdir(path.join(repoDir, "packages/shared/src"), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(repoDir, "packages/shared/src/format.ts"),
        `export const formatCurrency = (val: number): string => \`$\${val.toFixed(2)}\`;\n`,
      );

      // App file importing @fixture/core, @shared/format, and external package
      await fs.mkdir(path.join(repoDir, "packages/app/src"), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(repoDir, "packages/app/src/CheckoutView.tsx"),
        `import React from "react";\nimport { calculateTotal } from "@fixture/core";\nimport { formatCurrency } from "@shared/format";\n\nexport function CheckoutView() {\n  const sum = calculateTotal([10, 20]);\n  return <div>{formatCurrency(sum)}</div>;\n}\n`,
      );

      // Non-TS file (Python) — must store metadata only, no fake symbols
      await fs.mkdir(path.join(repoDir, "scripts"), { recursive: true });
      await fs.writeFile(
        path.join(repoDir, "scripts/worker.py"),
        `import os\n\ndef run_task():\n    return os.getcwd()\n`,
      );

      // Ignored files via .gitignore
      await fs.mkdir(path.join(repoDir, "ignored_dir"), { recursive: true });
      await fs.writeFile(
        path.join(repoDir, "ignored_dir/should_skip.ts"),
        `export const skipped = true;\n`,
      );
      await fs.writeFile(
        path.join(repoDir, "packages/core/src/scratch.tmp.ts"),
        `export const tmp = 1;\n`,
      );

      const store = new ProjectIndexStore(storeDir);
      const indexer = new ProjectIndexer(store);
      const localSource = new LocalRepositorySource({ rootDir: repoDir });

      const snapshot = await indexer.indexRepository(
        "proj_local" as ProjectId,
        localSource,
      );

      expect(snapshot.commitSha).toBe(commitSha);
      expect(snapshot.ref).toBe("main");

      const indexedPaths = snapshot.files.map((f) => f.path);
      expect(indexedPaths).toContain("packages/core/src/math.ts");
      expect(indexedPaths).toContain("packages/core/src/index.ts");
      expect(indexedPaths).toContain("packages/shared/src/format.ts");
      expect(indexedPaths).toContain("packages/app/src/CheckoutView.tsx");
      expect(indexedPaths).toContain("scripts/worker.py");
      // .gitignore excluded files must not be present
      expect(indexedPaths).not.toContain("ignored_dir/should_skip.ts");
      expect(indexedPaths).not.toContain("packages/core/src/scratch.tmp.ts");

      // Check TS AST extraction
      const mathEntry = snapshot.files.find(
        (f) => f.path === "packages/core/src/math.ts",
      )!;
      expect(mathEntry.lang).toBe("ts");
      expect(mathEntry.symbols.map((s) => s.name)).toContain("calculateTotal");
      expect(mathEntry.exports).toContain("calculateTotal");

      // Check Python metadata-only rule (no fake AST parsing)
      const pyEntry = snapshot.files.find(
        (f) => f.path === "scripts/worker.py",
      )!;
      expect(pyEntry.lang).toBe("py");
      expect(pyEntry.lineCount).toBeGreaterThanOrEqual(4);
      expect(pyEntry.symbols).toEqual([]);
      expect(pyEntry.imports).toEqual([]);
      expect(pyEntry.exports).toEqual([]);

      // Check Import Graph (relative `.js` -> `.ts`, workspace `@fixture/core`, and tsconfig `@shared/*`)
      expect(
        snapshot.graph.importsByFile["packages/core/src/index.ts"],
      ).toEqual(["packages/core/src/math.ts"]);
      expect(
        snapshot.graph.importedByFile["packages/core/src/math.ts"],
      ).toEqual(["packages/core/src/index.ts"]);

      expect(
        snapshot.graph.importsByFile["packages/app/src/CheckoutView.tsx"],
      ).toEqual([
        "packages/core/src/index.ts",
        "packages/shared/src/format.ts",
      ]);
      expect(
        snapshot.graph.importedByFile["packages/core/src/index.ts"],
      ).toEqual(["packages/app/src/CheckoutView.tsx"]);
      expect(
        snapshot.graph.externalImportsByFile[
          "packages/app/src/CheckoutView.tsx"
        ],
      ).toEqual(["react"]);

      const coreWorkspace = snapshot.graph.workspaces.find(
        (w) => w.name === "@fixture/core",
      );
      expect(coreWorkspace).toBeDefined();
      expect(coreWorkspace?.entryPath).toBe("packages/core/src/index.ts");
    });
  });

  describe("3. GitLab source, pagination, 429 Retry-After, and incremental zero-download reuse", () => {
    it("paginates tree, respects 429 Retry-After, and reuses unchanged entries without re-downloading raw blobs", async () => {
      const storeDir = path.join(tempDir, "gitlab-store");
      const store = new ProjectIndexStore(storeDir);
      const indexer = new ProjectIndexer(store);

      let currentCommit = "1111111111111111111111111111111111111111";
      let rawFileDownloads: string[] = [];
      let rateLimitedOnce = false;

      const fileContentsCommit1: Record<string, { sha: string; text: string }> =
        {
          "package.json": {
            sha: "blob_pkg_1",
            text: JSON.stringify({ name: "gl-app" }),
          },
          "src/a.ts": {
            sha: "blob_a_1",
            text: `export const a = () => "v1";\n`,
          },
          "src/b.ts": {
            sha: "blob_b_1",
            text: `import { a } from "./a.js";\nexport const b = () => a();\n`,
          },
        };

      const fileContentsCommit2: Record<string, { sha: string; text: string }> =
        {
          "package.json": {
            sha: "blob_pkg_1",
            text: JSON.stringify({ name: "gl-app" }),
          },
          "src/a.ts": {
            sha: "blob_a_1", // Unchanged blob SHA!
            text: `export const a = () => "v1";\n`,
          },
          "src/b.ts": {
            sha: "blob_b_2", // Changed blob SHA in commit 2
            text: `import { a } from "./a.js";\nexport const b = () => a() + "-v2";\n`,
          },
        };

      const mockHttp = new MockHttpClient(async (req) => {
        const activeFiles =
          currentCommit === "1111111111111111111111111111111111111111"
            ? fileContentsCommit1
            : fileContentsCommit2;

        if (req.url.includes("/repository/commits/")) {
          return {
            status: 200,
            body: { id: currentCommit },
          };
        }

        if (req.url.includes("/repository/tree")) {
          if (!rateLimitedOnce) {
            rateLimitedOnce = true;
            return {
              status: 429,
              body: { message: "Too Many Requests" },
              headers: { "retry-after": "0.01" },
            };
          }

          if (req.url.includes("&page=1&")) {
            return {
              status: 200,
              headers: { "x-next-page": "2" },
              body: [
                {
                  id: activeFiles["package.json"]!.sha,
                  name: "package.json",
                  type: "blob",
                  path: "package.json",
                },
                {
                  id: activeFiles["src/a.ts"]!.sha,
                  name: "a.ts",
                  type: "blob",
                  path: "src/a.ts",
                },
              ],
            };
          }

          return {
            status: 200,
            headers: { "x-next-page": "" },
            body: [
              {
                id: activeFiles["src/b.ts"]!.sha,
                name: "b.ts",
                type: "blob",
                path: "src/b.ts",
              },
            ],
          };
        }

        if (req.url.includes("/repository/files/")) {
          const match = /\/repository\/files\/([^/]+)\/raw/.exec(req.url);
          const filePath = decodeURIComponent(match?.[1] ?? "");
          rawFileDownloads.push(filePath);
          const found = activeFiles[filePath];
          if (!found) return { status: 404, body: "Not found" };
          return { status: 200, body: found.text };
        }

        return { status: 404, body: "Unknown route" };
      });

      const source = new GitLabRepositorySource(mockHttp, {
        baseUrl: "https://gitlab.example.com",
        projectPath: "eng/gl-app",
        token: "glpat-testtoken123456",
        defaultBranch: "main",
      });

      // First index run (commit 1)
      const snap1 = await indexer.indexRepository(
        "proj_gl" as ProjectId,
        source,
      );
      expect(snap1.commitSha).toBe(
        "1111111111111111111111111111111111111111",
      );
      expect(snap1.stats.indexedFilesCount).toBe(3);
      expect(snap1.stats.reusedFilesCount).toBe(0);
      expect(rawFileDownloads.sort()).toEqual([
        "package.json",
        "src/a.ts",
        "src/b.ts",
      ]);

      // Second index run (commit 2: src/a.ts is unchanged, src/b.ts changed)
      rawFileDownloads = [];
      currentCommit = "2222222222222222222222222222222222222222";

      const snap2 = await indexer.indexRepository(
        "proj_gl" as ProjectId,
        source,
      );
      expect(snap2.commitSha).toBe(
        "2222222222222222222222222222222222222222",
      );
      expect(snap2.stats.indexedFilesCount).toBe(3);
      // Both `src/a.ts` (via gitBlobSha fast-path without downloading!) and `package.json` (via contentHash) are reused
      expect(snap2.stats.reusedFilesCount).toBe(2);
      // Critically: `src/a.ts` was NOT re-downloaded over the network because its gitBlobSha matched!
      expect(rawFileDownloads).not.toContain("src/a.ts");
      expect(rawFileDownloads).toContain("src/b.ts");
      expect(snap2.graph.importsByFile["src/b.ts"]).toEqual(["src/a.ts"]);
    });
  });

  describe("4. GitHub source with truncated recursive tree fallback & base64 blobs", () => {
    it("walks subtrees breadth-first when GitHub recursive tree returns truncated: true", async () => {
      const storeDir = path.join(tempDir, "github-store");
      const store = new ProjectIndexStore(storeDir);
      const indexer = new ProjectIndexer(store);
      const commitSha = "abcdef1234567890abcdef1234567890abcdef12";

      const mockHttp = new MockHttpClient(async (req) => {
        if (req.url === "https://api.github.com/repos/acme/web") {
          return { status: 200, body: { default_branch: "main" } };
        }
        if (req.url.endsWith(`/commits/main`)) {
          return { status: 200, body: { sha: commitSha } };
        }
        // Recursive call returns truncated: true
        if (req.url.endsWith(`/git/trees/${commitSha}?recursive=1`)) {
          return {
            status: 200,
            body: {
              sha: commitSha,
              truncated: true,
              tree: [],
            },
          };
        }
        // Root non-recursive tree call
        if (req.url.endsWith(`/git/trees/${commitSha}`)) {
          return {
            status: 200,
            body: {
              sha: commitSha,
              truncated: false,
              tree: [
                {
                  path: "src",
                  type: "tree",
                  sha: "tree_src_sha",
                },
              ],
            },
          };
        }
        // Subtree call for `src`
        if (req.url.endsWith(`/git/trees/tree_src_sha`)) {
          return {
            status: 200,
            body: {
              sha: "tree_src_sha",
              truncated: false,
              tree: [
                {
                  path: "index.ts",
                  type: "blob",
                  sha: "blob_index_sha",
                  size: 42,
                },
              ],
            },
          };
        }
        if (req.url.endsWith(`/git/blobs/blob_index_sha`)) {
          const b64 = Buffer.from(
            `export function greet(name: string): string {\n  return "hi " + name;\n}\n`,
            "utf8",
          ).toString("base64");
          return {
            status: 200,
            body: {
              sha: "blob_index_sha",
              encoding: "base64",
              content: b64,
            },
          };
        }
        return { status: 404, body: { message: "Not Found" } };
      });

      const ghSource = new GitHubRepositorySource(mockHttp, {
        repositoryPath: "acme/web",
        token: "ghp_mocktoken1234567890",
      });

      const snapshot = await indexer.indexRepository(
        "proj_gh" as ProjectId,
        ghSource,
      );
      expect(snapshot.commitSha).toBe(commitSha);
      expect(snapshot.files).toHaveLength(1);
      expect(snapshot.files[0]!.path).toBe("src/index.ts");
      expect(snapshot.files[0]!.symbols.map((s) => s.name)).toEqual(["greet"]);
    });
  });

  describe("5. Atomic writes, snapshot retention, job cancellation, and secret non-leakage", () => {
    it("retains only the last N=3 snapshots and updates latest.json atomically", async () => {
      const storeDir = path.join(tempDir, "retention-store");
      const store = new ProjectIndexStore({
        baseDir: storeDir,
        retentionCount: 3,
      });
      const projectId = "proj_ret" as ProjectId;

      for (let i = 1; i <= 5; i++) {
        const sha = `${String(i).repeat(40)}`;
        await store.saveSnapshot({
          schemaVersion: 1,
          projectId,
          ref: "main",
          commitSha: sha,
          createdAt: new Date(1_700_000_000_000 + i * 1000).toISOString(),
          stats: {
            totalFilesScanned: 1,
            indexedFilesCount: 1,
            skippedFilesCount: 0,
            reusedFilesCount: 0,
            downloadedFilesCount: 1,
            totalBytes: 10,
            totalSymbols: 0,
            countsByLanguage: { ts: 1 },
            durationMs: 5,
          },
          files: [],
          graph: {
            importsByFile: {},
            importedByFile: {},
            externalImportsByFile: {},
            workspaces: [],
            pathAliases: {},
          },
        });
      }

      const retainedShas = await store.listSnapshotCommitShas(projectId);
      expect(retainedShas).toHaveLength(3);
      expect(retainedShas).toEqual([
        "3".repeat(40),
        "4".repeat(40),
        "5".repeat(40),
      ]);

      const latest = await store.getLatestSnapshot(projectId);
      expect(latest?.commitSha).toBe("5".repeat(40));
    });

    it("enforces one concurrent job per project and supports mid-flight cancellation", async () => {
      const storeDir = path.join(tempDir, "cancel-store");
      const store = new ProjectIndexStore(storeDir);
      const project = makeProject({ id: "proj_cancel" as ProjectId });

      const slowHttp = new MockHttpClient(async (req) => {
        if (req.url.includes("/repository/commits/")) {
          await new Promise((r) => setTimeout(r, 80));
          return { status: 200, body: { id: "a".repeat(40) } };
        }
        await new Promise((r) => setTimeout(r, 200));
        return { status: 200, body: [] };
      });

      const manager = new IndexJobManager(store, slowHttp);
      const job1 = await manager.startJob({ project });
      const job2 = await manager.startJob({ project });

      // Must deduplicate concurrent job requests for the same project
      expect(job2.id).toBe(job1.id);

      // Cancel while running
      const cancelled = manager.cancelJob(project.id);
      expect(cancelled).toBe(true);

      const finalJob = await manager.waitForJob(project.id);
      expect(finalJob?.status).toBe("cancelled");

      const persistedJob = await store.getJob(project.id);
      expect(persistedJob?.status).toBe("cancelled");
    });

    it("proves tokens never appear in snapshots, job.json, or error messages", async () => {
      const storeDir = path.join(tempDir, "secret-store");
      const store = new ProjectIndexStore(storeDir);
      const secretGitLabPat = "glpat-SUPER_SECRET_TOKEN_VALUE_987654321";
      const secretGitHubPat = "ghp_ULTRA_SECRET_GH_TOKEN_1234567890";

      // Case A: Failed job where upstream server echoes token in body and URL
      const failingHttp = new MockHttpClient(async () => ({
        status: 401,
        body: {
          message: `Unauthorized token ${secretGitLabPat} at https://oauth2:${secretGitLabPat}@gitlab.example.com/api/v4?private_token=${secretGitLabPat} and Authorization: Bearer ${secretGitHubPat}`,
        },
      }));

      const projectFail = makeProject({ id: "proj_sec_fail" as ProjectId });
      const failManager = new IndexJobManager(store, failingHttp);
      await failManager.startJob({
        project: projectFail,
        credentials: { token: secretGitLabPat },
      });
      const failedJob = await failManager.waitForJob(projectFail.id);

      expect(failedJob?.status).toBe("failed");
      expect(failedJob?.error).toBeDefined();
      expect(failedJob?.error).not.toContain(secretGitLabPat);
      expect(failedJob?.error).not.toContain(secretGitHubPat);
      expect(failedJob?.error).toContain("[REDACTED]");

      const rawJobJsonFail = await fs.readFile(
        path.join(storeDir, "proj_sec_fail", "job.json"),
        "utf8",
      );
      expect(rawJobJsonFail).not.toContain(secretGitLabPat);
      expect(rawJobJsonFail).not.toContain(secretGitHubPat);

      // Case B: Successful job — verify neither snapshot JSON nor job.json contains token
      const commitSha = "f".repeat(40);
      const okHttp = new MockHttpClient(async (req) => {
        if (req.url.includes("/repository/commits/")) {
          return { status: 200, body: { id: commitSha } };
        }
        if (req.url.includes("/repository/tree")) {
          return {
            status: 200,
            body: [
              {
                id: "blob_1",
                name: "index.ts",
                type: "blob",
                path: "src/index.ts",
              },
            ],
          };
        }
        return { status: 200, body: "export const ok = true;\n" };
      });

      const projectOk = makeProject({ id: "proj_sec_ok" as ProjectId });
      const okManager = new IndexJobManager(store, okHttp);
      await okManager.startJob({
        project: projectOk,
        credentials: { token: secretGitLabPat },
      });
      const succeededJob = await okManager.waitForJob(projectOk.id);
      expect(succeededJob?.status).toBe("succeeded");

      const rawSnapJson = await fs.readFile(
        path.join(storeDir, "proj_sec_ok", `${commitSha}.json`),
        "utf8",
      );
      const rawJobJsonOk = await fs.readFile(
        path.join(storeDir, "proj_sec_ok", "job.json"),
        "utf8",
      );
      expect(rawSnapJson).not.toContain(secretGitLabPat);
      expect(rawJobJsonOk).not.toContain(secretGitLabPat);
      expect(redactSecrets(`token=${secretGitLabPat}`, [secretGitLabPat])).toBe(
        "token=[REDACTED]",
      );
    });
  });
});

describe("buildReviewContext", async () => {
  const { buildReviewContext } = await import("./review-context.js");
  const snapshot = {
    schemaVersion: 1,
    projectId: "p",
    ref: "main",
    commitSha: "a".repeat(40),
    createdAt: "2026-01-01T00:00:00.000Z",
    stats: {},
    files: [
      { path: "src/db.ts", exports: ["q"], imports: [], symbols: [] },
      { path: "src/app.ts", exports: [], imports: [], symbols: [] },
      { path: "src/lonely.ts", exports: [], imports: [], symbols: [] },
    ],
    graph: {
      importsByFile: { "src/app.ts": ["src/db.ts"] },
      importedByFile: { "src/db.ts": ["src/app.ts"] },
      externalImportsByFile: {},
      workspaces: [],
      pathAliases: {},
    },
  } as never;

  it("describes changed files and flags dependants outside the change", () => {
    const text = buildReviewContext(snapshot, ["b/src/db.ts"]);
    expect(text).toContain("src/db.ts: exports q; imported by 1 file(s): src/app.ts");
    expect(text).toContain("not part of this change");
    expect(text).toContain("src/app.ts");
  });

  it("does not flag dependants that are in the change itself", () => {
    const text = buildReviewContext(snapshot, ["src/db.ts", "src/app.ts"]);
    expect(text).not.toContain("not part of this change");
  });

  it("returns empty for unindexed files and handles files with no importers", () => {
    expect(buildReviewContext(snapshot, ["src/new.ts"])).toBe("");
    expect(buildReviewContext(snapshot, ["src/lonely.ts"])).toContain("not imported by other indexed files");
  });
});

describe("listBranches", () => {
  const route = (table: Record<string, unknown>): HttpClient => ({
    async send(req: HttpRequest) {
      const key = Object.keys(table).find((k) => req.url.includes(k));
      return { ok: true, value: { status: key ? 200 : 404, body: key ? table[key] : {} } } as never;
    },
  });

  it("GitLab: default branch first, then alphabetical, deduplicated", async () => {
    const { GitLabRepositorySource } = await import("./sources/gitlab-source.js");
    const source = new GitLabRepositorySource(
      route({
        "/repository/branches": [{ name: "feature/z" }, { name: "develop" }, { name: "main" }, { name: "develop" }],
        "/api/v4/projects/team%2Fapp": { default_branch: "develop" },
      }),
      { baseUrl: "https://gl.example.com", projectPath: "team/app" },
    );
    const res = await source.listBranches!();
    expect(res.defaultBranch).toBe("develop");
    expect(res.branches).toEqual(["develop", "feature/z", "main"]);
  });

  it("GitHub: reads default branch from the repo and lists branches", async () => {
    const { GitHubRepositorySource } = await import("./sources/github-source.js");
    const source = new GitHubRepositorySource(
      route({
        "/branches": [{ name: "zeta" }, { name: "alpha" }],
        "/repos/o/r": { default_branch: "trunk" },
      }),
      { repositoryPath: "o/r", gitHost: "github.com" },
    );
    const res = await source.listBranches!();
    expect(res).toEqual({ defaultBranch: "trunk", branches: ["trunk", "alpha", "zeta"] });
  });

  it("surfaces host errors without leaking the token", async () => {
    const { GitLabRepositorySource } = await import("./sources/gitlab-source.js");
    const source = new GitLabRepositorySource(
      { async send() { return { ok: true, value: { status: 401, body: { message: "bad token glpat-SECRET123" } } } as never; } },
      { baseUrl: "https://gl.example.com", projectPath: "team/app", token: "glpat-SECRET123" },
    );
    await expect(source.listBranches!()).rejects.toThrow(/HTTP 401/);
    await expect(source.listBranches!()).rejects.not.toThrow(/glpat-SECRET123/);
  });
});
