import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { ProjectStore, instructionsForPrompt } from "./project-store.js";

const base = {
  verdict: "down" as const,
  reason: "our_standard",
  title: "console.log in CLI",
  category: "style",
  severity: "low",
  file: "bin/cli.ts",
};

describe("ProjectStore feedback", () => {
  let dir: string;
  let store: ProjectStore;
  let id: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "feedback-test-"));
    store = new ProjectStore(dir);
    id = (await store.createProject({ name: "P", repositoryUrl: "https://gitlab.example.com/a/b" })).id;
  });
  afterEach(() => fs.rm(dir, { recursive: true, force: true }));

  it("appends a rule once under one heading", async () => {
    await store.addFeedback(id, base, "Do not flag console.log in CLI.");
    const again = await store.addFeedback(id, base, "Do not flag console.log in CLI.");
    await store.addFeedback(id, base, "Second rule.");
    const text = (await store.getProject(id))!.project.customInstructions!;
    expect(text.match(/Learned from reviewer feedback:/g)).toHaveLength(1);
    expect(text.match(/Do not flag console.log in CLI\./g)).toHaveLength(1);
    expect(text).toContain("- Second rule.");
    expect(again.record.ruleAdded).toBe(true);
  });

  it("keeps un-promoted rejections as a digest, not in instructions", async () => {
    await store.addFeedback(id, { ...base, note: "ok" });
    await store.addFeedback(id, { ...base, title: "Promoted" }, "Rule");
    const digest = await store.getFeedbackDigest(id);
    expect(digest).toContain("console.log in CLI");
    expect(digest).not.toContain("Promoted");
    expect((await store.getProject(id))!.project.customInstructions).not.toContain("console.log in CLI");
  });

  it("uses the compact instructions only while they match the full text", async () => {
    await store.updateProject(id, { customInstructions: "Long full rules text", compactInstructions: "Short rules" });
    expect(instructionsForPrompt((await store.getProject(id))!.project)).toBe("Short rules");

    // A learned rule is added to both versions, so the compact one stays valid.
    await store.addFeedback(id, base, "Allow console.log in CLI");
    const afterRule = (await store.getProject(id))!.project;
    expect(instructionsForPrompt(afterRule)).toContain("Short rules");
    expect(instructionsForPrompt(afterRule)).toContain("Allow console.log in CLI");

    // Editing the full text without a new compact drops the stale one.
    await store.updateProject(id, { customInstructions: "Completely new rules" });
    const edited = (await store.getProject(id))!.project;
    expect(edited.compactInstructions).toBeUndefined();
    expect(instructionsForPrompt(edited)).toBe("Completely new rules");
  });
});
