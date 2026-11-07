import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { ProjectStore } from "../project-store.js";
import {
  reviewCatalogHandler,
  updateReviewConfigHandler,
  MAX_AGENT_INSTRUCTION_LENGTH,
} from "./review-config.js";
import { submitFeedbackHandler, enforceableSuppressions } from "./projects.js";
import { SPECIALISTS } from "@ai-review/shared";
import { DEFAULT_RULES } from "@ai-review/orchestrator";

const stubSecurity = (canManage: boolean) =>
  ({
    canAccessProject: async (_u: unknown, _p: unknown, perm: string) => (perm === "project:manage" ? canManage : true),
    auditStore: { log: async () => {} },
  }) as any;
const user = { id: "u1", name: "U", email: "u@x.io" } as any;

describe("review catalog", () => {
  it("lists the real specialists and rules", () => {
    const c = reviewCatalogHandler();
    expect(c.agents.map((a) => a.id)).toEqual(SPECIALISTS.map((s) => s.id));
    expect(c.agents[0]).toMatchObject({ name: expect.any(String), goal: expect.any(String), checklist: expect.any(String), focus: expect.any(String) });
    expect(c.agents.find((a) => a.id === "agent.security-reviewer")!.locked).toBe(true);
    expect(c.agents.find((a) => a.id === "agent.react-reviewer")!.locked).toBe(false);
    expect(c.agents.some((a) => a.id === "agent.dead-code-analyzer")).toBe(false);
    expect(c.agents.some((a) => a.id === "agent.contributing-reviewer")).toBe(true);

    expect(c.rules.map((r) => r.id)).toEqual(DEFAULT_RULES.map((r) => r.id));
    expect(c.rules.length).toBeGreaterThan(30);
    for (const r of c.rules) expect(r.description.length).toBeGreaterThan(5);
    const byId = new Map(c.rules.map((r) => [r.id, r]));
    expect(byId.get("secret.hardcoded")).toMatchObject({ security: true, severity: "high" });
    expect(byId.get("security.prompt-injection")!.security).toBe(true);
    expect(byId.get("no-eval")).toMatchObject({ security: true, severity: "critical" });
    expect(byId.get("no-console")).toMatchObject({ security: false, severity: "low" });
    expect(c.limits.maxAgentInstructionLength).toBe(MAX_AGENT_INSTRUCTION_LENGTH);
  });
});

describe("updateReviewConfigHandler", () => {
  let dir: string;
  let store: ProjectStore;
  let id: string;
  const put = (body: any, canManage = true) =>
    updateReviewConfigHandler(store, id, body, stubSecurity(canManage), user);
  const status = async (p: Promise<unknown>) => {
    try {
      await p;
      return 200;
    } catch (e: any) {
      return e.status as number;
    }
  };
  const stored = async () => (await store.getProject(id))!.project;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "review-config-test-"));
    store = new ProjectStore(dir);
    id = (await store.createProject({ name: "P", repositoryUrl: "https://gitlab.example.com/a/b" })).id;
  });
  afterEach(() => fs.rm(dir, { recursive: true, force: true }));

  it("a project without any of the fields stays valid and unchanged", async () => {
    const p = await stored();
    expect(p.disabledAgents).toBeUndefined();
    expect(p.agentInstructions).toBeUndefined();
    expect(p.suppressedRules).toBeUndefined();
  });

  it("refuses a user who cannot manage the project", async () => {
    expect(await status(put({ disabledAgents: ["agent.react-reviewer"] }, false))).toBe(403);
    expect((await stored()).disabledAgents).toBeUndefined();
  });

  it("persists agents, instructions and rules, also across a reload", async () => {
    await put({
      disabledAgents: ["agent.react-reviewer", "agent.react-reviewer"],
      agentInstructions: { "agent.code-reviewer": "  Prefer early returns.  ", "agent.python-reviewer": "   " },
      disabledRules: ["no-console"],
    });
    const expected = {
      disabledAgents: ["agent.react-reviewer"],
      agentInstructions: { "agent.code-reviewer": "Prefer early returns." },
      suppressedRules: [{ ruleId: "no-console" }],
    };
    expect(await stored()).toMatchObject(expected);
    const reloaded = await new ProjectStore(dir).getProject(id);
    expect(reloaded!.project).toMatchObject(expected);
  });

  it("replaces per field and removes fields when emptied", async () => {
    await put({ disabledAgents: ["agent.react-reviewer"], disabledRules: ["no-console"], agentInstructions: { "agent.code-reviewer": "x" } });
    await put({ disabledAgents: [] });
    let p = await stored();
    expect(p.disabledAgents).toBeUndefined();
    expect(p.suppressedRules).toEqual([{ ruleId: "no-console" }]);
    expect(p.agentInstructions).toEqual({ "agent.code-reviewer": "x" });
    await put({ agentInstructions: {}, disabledRules: [] });
    p = await stored();
    expect(p.agentInstructions).toBeUndefined();
    expect(p.suppressedRules).toBeUndefined();
  });

  it("keeps file-scoped and non-catalog suppressions when project-wide rules change", async () => {
    await store.addFeedback(id, { verdict: "down", reason: "x", title: "t", category: "c", severity: "low", file: "a.ts" }, undefined, { ruleId: "secret.hardcoded", file: "a.ts" });
    await store.addFeedback(id, { verdict: "down", reason: "x", title: "t", category: "c", severity: "low", file: "a.ts" }, undefined, { ruleId: "governance.branch-naming" });
    await put({ disabledRules: ["no-console"] });
    await put({ disabledRules: [] });
    expect((await stored()).suppressedRules).toEqual([
      { ruleId: "secret.hardcoded", file: "a.ts" },
      { ruleId: "governance.branch-naming" },
    ]);
  });

  it("rejects unknown agent and rule ids", async () => {
    expect(await status(put({ disabledAgents: ["agent.nope"] }))).toBe(400);
    expect(await status(put({ agentInstructions: { "agent.dead-code-analyzer": "x" } }))).toBe(400);
    expect(await status(put({ disabledRules: ["no-such-rule"] }))).toBe(400);
    expect((await stored()).disabledAgents).toBeUndefined();
  });

  it("rejects non-string values, bad shapes and over-long text", async () => {
    expect(await status(put({ agentInstructions: { "agent.code-reviewer": 5 } }))).toBe(400);
    expect(await status(put({ agentInstructions: ["x"] }))).toBe(400);
    expect(await status(put({ disabledAgents: "agent.react-reviewer" }))).toBe(400);
    expect(await status(put({ disabledAgents: [1] }))).toBe(400);
    expect(await status(put({ disabledRules: [null] }))).toBe(400);
    expect(await status(put({}))).toBe(400);
    expect(await status(put("nope" as any))).toBe(400);
    const tooLong = "x".repeat(MAX_AGENT_INSTRUCTION_LENGTH + 1);
    expect(await status(put({ agentInstructions: { "agent.code-reviewer": tooLong } }))).toBe(400);
    expect(await status(put({ agentInstructions: { "agent.code-reviewer": "x".repeat(MAX_AGENT_INSTRUCTION_LENGTH) } }))).toBe(200);
  });

  it("refuses to silence a security rule project-wide, whatever the client sends", async () => {
    for (const rule of ["secret.hardcoded", "security.sql-injection", "security.wildcard-cors", "security.prompt-injection", "security.tls-verify-disabled", "no-eval"]) {
      expect(await status(put({ disabledRules: ["no-console", rule] }))).toBe(400);
    }
    expect((await stored()).suppressedRules).toBeUndefined();
  });

  it("refuses to disable the security reviewer", async () => {
    expect(await status(put({ disabledAgents: ["agent.react-reviewer", "agent.security-reviewer"] }))).toBe(400);
    expect((await stored()).disabledAgents).toBeUndefined();
  });

  it("404s for a missing project", async () => {
    expect(await status(updateReviewConfigHandler(store, "nope", { disabledAgents: [] }, stubSecurity(true), user))).toBe(404);
  });

  it("feedback silences no-eval for one file only, and refuses without a file", async () => {
    const issue = (file?: string) => ({
      title: "no-eval",
      category: "eslint",
      severity: "critical",
      producedBy: "agent.rule-engine",
      ...(file ? { location: { file } } : {}),
    });
    const fb = (i: any) =>
      submitFeedbackHandler(store, id, { verdict: "down", addToRules: true, rule: "x", issue: i }, stubSecurity(true), user);
    await fb(issue());
    expect((await stored()).suppressedRules).toBeUndefined();
    await fb(issue("src/a.js"));
    expect((await stored()).suppressedRules).toEqual([{ ruleId: "no-eval", file: "src/a.js" }]);
  });

  it("the engines ignore a stored project-wide silence of a security rule", () => {
    expect(
      enforceableSuppressions([
        { ruleId: "no-eval" },
        { ruleId: "no-eval", file: "a.js" },
        { ruleId: "no-console" },
      ]),
    ).toEqual([{ ruleId: "no-eval", file: "a.js" }, { ruleId: "no-console" }]);
  });
});
