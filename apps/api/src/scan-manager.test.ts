import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { IndexJobManager, ProjectIndexStore, type RepositorySource } from "@ai-review/project-index";
import type { Project } from "@ai-review/core";
import { ScanJobManager, ScanStore } from "./scan-manager.js";

const FILES: Record<string, string> = {
  "app/util.py": 'import pickle\ndata = pickle.loads(blob)\nprint(data)\n',
  "src/a.ts": 'const API_KEY = "sk-live-abcdef123456";\nconsole.log(1);\nconsole.log(2);\n',
  "Dockerfile": "FROM node:latest\n",
  "node_modules/x/index.js": "console.log('ignored')",
  "logo.png": "binary",
  "bin.dat": "ab\u0000cd",
};

function fakeSource(): RepositorySource {
  return {
    kind: "local",
    resolveRef: async (ref) => ({ ref: ref ?? "main", commitSha: "c0ffee" }),
    listTree: async () => Object.keys(FILES).map((p) => ({ path: p, size: FILES[p]!.length })),
    readFile: async (entry) => FILES[entry.path]!,
  };
}

const project = { id: "p1", gitHost: "gitlab.example.com", repositoryPath: "g/p", repositoryUrl: "https://gitlab.example.com/g/p", defaultBranch: "main" } as unknown as Project;

describe("ScanJobManager", () => {
  it("scans a branch with rules only, keeps per-line findings and hides secrets", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "scan-"));
    try {
      const store = new ScanStore(dir);
      const mgr = new ScanJobManager(store, new IndexJobManager(new ProjectIndexStore(path.join(dir, "idx"))));
      await mgr.startJob({ project, sourceOverride: fakeSource() });
      const job = await mgr.waitForJob("p1");
      expect(job?.status).toBe("succeeded");
      expect(job?.commitSha).toBe("c0ffee");

      const report = await store.getReport("p1", "main");
      expect(report).toBeDefined();
      const rules = report!.findings.map((f) => `${f.file}:${f.line}:${f.ruleId}`);
      expect(rules).toEqual(
        expect.arrayContaining([
          "app/util.py:2:py.unsafe-deserialization",
          "src/a.ts:2:no-console",
          "src/a.ts:3:no-console",
          "Dockerfile:1:docker.latest-tag",
        ]),
      );
      // node_modules, images and binary content are skipped
      expect(report!.findings.some((f) => f.file.startsWith("node_modules"))).toBe(false);
      expect(report!.summary.filesScanned).toBe(3);
      // sorted most severe first; secret lines are never stored
      expect(report!.findings[0]!.severity).toBe("high");
      const secret = report!.findings.find((f) => f.ruleId === "secret.hardcoded")!;
      expect(secret.snippet).toBeUndefined();
      expect(JSON.stringify(report)).not.toContain("sk-live");
      expect((await store.getHistory("p1"))).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports a failed job without leaking the token", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "scan-"));
    try {
      const store = new ScanStore(dir);
      const mgr = new ScanJobManager(store, new IndexJobManager(new ProjectIndexStore(path.join(dir, "idx"))));
      const bad: RepositorySource = {
        ...fakeSource(),
        resolveRef: async () => { throw new Error("401 for token glpat-SECRET123"); },
      };
      await mgr.startJob({ project, sourceOverride: bad, credentials: { token: "glpat-SECRET123" } });
      const job = await mgr.waitForJob("p1");
      expect(job?.status).toBe("failed");
      expect(job?.error).not.toContain("glpat-SECRET123");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
