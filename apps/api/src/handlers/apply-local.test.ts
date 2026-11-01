import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { applyLocalHandler } from "./apply-local.js";

const issue = (file: string) => ({
  accepted: true,
  severity: "high",
  title: "Bug",
  reason: "because",
  location: { file, line: 1 },
});

describe("applyLocalHandler path safety", () => {
  let root: string;
  let outside: string;

  beforeEach(async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "ai-review-apply-"));
    root = path.join(base, "repo");
    outside = path.join(base, "secret.txt");
    await fs.mkdir(root);
    await fs.writeFile(path.join(root, "a.ts"), "const a = 1;\n");
    await fs.writeFile(outside, "untouched\n");
  });

  afterEach(async () => {
    await fs.rm(path.dirname(root), { recursive: true, force: true });
  });

  it("inserts comments into files inside the repository", async () => {
    await applyLocalHandler({ localPath: root, issues: [issue("a.ts")] });
    expect(await fs.readFile(path.join(root, "a.ts"), "utf8")).toContain("FIXME [HIGH]");
  });

  it("refuses to touch files outside the root via traversal or absolute paths", async () => {
    await applyLocalHandler({
      localPath: root,
      issues: [issue("../secret.txt"), issue(outside)],
    });
    expect(await fs.readFile(outside, "utf8")).toBe("untouched\n");
  });

  it("refuses symlinks that escape the root", async () => {
    await fs.symlink(outside, path.join(root, "link.ts"));
    await applyLocalHandler({ localPath: root, issues: [issue("link.ts")] });
    expect(await fs.readFile(outside, "utf8")).toBe("untouched\n");
  });

  it("rejects a localPath that is not a directory", async () => {
    await expect(
      applyLocalHandler({ localPath: path.join(root, "missing"), issues: [] }),
    ).rejects.toThrow(/existing directory/);
  });
});
