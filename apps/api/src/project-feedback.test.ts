import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { ProjectStore, instructionsForPrompt } from "./project-store.js";
import { submitFeedbackHandler, removeSuppressedRuleHandler } from "./handlers/projects.js";

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

describe("rule suppression via feedback", () => {
  let dir: string;
  let store: ProjectStore;
  let id: string;
  const ruleIssue = (category: string, title = "style.console-log") => ({
    title,
    category,
    severity: "low",
    producedBy: "agent.rule-engine",
    location: { file: "src/a.ts" },
  });
  const body = (issue: ReturnType<typeof ruleIssue>) => ({
    verdict: "down" as const,
    addToRules: true,
    rule: "Do not report this",
    issue,
  });
  const stubSecurity = (canManage: boolean) =>
    ({
      canAccessProject: async (_u: unknown, _p: unknown, perm: string) => (perm === "project:manage" ? canManage : true),
      auditStore: { log: async () => {} },
    }) as any;
  const user = { id: "u1", name: "U", email: "u@x.io" } as any;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "suppress-test-"));
    store = new ProjectStore(dir);
    id = (await store.createProject({ name: "P", repositoryUrl: "https://gitlab.example.com/a/b" })).id;
  });
  afterEach(() => fs.rm(dir, { recursive: true, force: true }));

  it("store adds without duplicates and removes the exact entry", async () => {
    await store.addFeedback(id, base, undefined, { ruleId: "r1" });
    await store.addFeedback(id, base, undefined, { ruleId: "r1" });
    await store.addFeedback(id, base, undefined, { ruleId: "r1", file: "a.ts" });
    expect((await store.getProject(id))!.project.suppressedRules).toEqual([
      { ruleId: "r1" },
      { ruleId: "r1", file: "a.ts" },
    ]);
    await store.removeRuleSuppression(id, "r1");
    expect((await store.getProject(id))!.project.suppressedRules).toEqual([{ ruleId: "r1", file: "a.ts" }]);
    await store.removeRuleSuppression(id, "r1", "a.ts");
    expect((await store.getProject(id))!.project.suppressedRules).toBeUndefined();
  });

  it("a manager silences a non-security rule project-wide, without touching the guidelines", async () => {
    const r = await submitFeedbackHandler(store, id, body(ruleIssue("code")), stubSecurity(true), user);
    expect(r.ruleAdded).toBe(true);
    const project = (await store.getProject(id))!.project;
    expect(project.suppressedRules).toEqual([{ ruleId: "style.console-log" }]);
    expect(project.customInstructions).toBeUndefined();
  });

  it("security rules are always scoped to the file", async () => {
    await submitFeedbackHandler(store, id, body(ruleIssue("security", "secret.hardcoded")), stubSecurity(true), user);
    expect((await store.getProject(id))!.project.suppressedRules).toEqual([
      { ruleId: "secret.hardcoded", file: "src/a.ts" },
    ]);
  });

  it("a request cannot widen a security rule by sending another category", async () => {
    await submitFeedbackHandler(store, id, body(ruleIssue("code", "secret.hardcoded")), stubSecurity(true), user);
    expect((await store.getProject(id))!.project.suppressedRules).toEqual([
      { ruleId: "secret.hardcoded", file: "src/a.ts" },
    ]);
  });

  it("a non-manager cannot suppress; feedback is still saved", async () => {
    const r = await submitFeedbackHandler(store, id, body(ruleIssue("code")), stubSecurity(false), user);
    expect(r.ruleDenied).toBeTruthy();
    expect((await store.getProject(id))!.project.suppressedRules).toBeUndefined();
  });

  it("LLM findings still append learned text instead", async () => {
    const llm = { ...ruleIssue("code", "Some LLM finding"), producedBy: "agent.code-reviewer" };
    await submitFeedbackHandler(store, id, body(llm), stubSecurity(true), user);
    const project = (await store.getProject(id))!.project;
    expect(project.suppressedRules).toBeUndefined();
    expect(project.customInstructions).toContain("Do not report this");
  });

  it("removal endpoint handler is manager-only", async () => {
    await store.addFeedback(id, base, undefined, { ruleId: "r1" });
    await expect(
      removeSuppressedRuleHandler(store, id, { ruleId: "r1" }, stubSecurity(false), user),
    ).rejects.toMatchObject({ status: 403 });
    const ok = await removeSuppressedRuleHandler(store, id, { ruleId: "r1" }, stubSecurity(true), user);
    expect(ok.project.suppressedRules).toBeUndefined();
  });
});
