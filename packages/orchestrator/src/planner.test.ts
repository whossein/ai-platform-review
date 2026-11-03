import { describe, it, expect } from "vitest";
import { plan, changedFiles } from "./planner.js";
import { SPECIALISTS, makeSpecialistDefinition } from "@ai-review/shared";

const tsxDiff = `diff --git a/src/UserList.tsx b/src/UserList.tsx
--- a/src/UserList.tsx
+++ b/src/UserList.tsx
@@ -1,1 +1,3 @@
+export function UserList() { return <ul />; }
`;

const cssDiff = `diff --git a/src/app.css b/src/app.css
--- a/src/app.css
+++ b/src/app.css
@@ -1,1 +1,2 @@
+.title { color: red; }
`;

describe("planner / smart routing", () => {
  it("extracts changed files from git + +++ headers", () => {
    expect(changedFiles(tsxDiff)).toEqual(["src/UserList.tsx"]);
  });

  it("selects the React reviewer for a TSX change", () => {
    const agents = SPECIALISTS.map(s => makeSpecialistDefinition(s));
    const p = plan({ diff: tsxDiff, agents });
    const ids = p.selected.map((s) => s.id);
    expect(ids).toContain("agent.react-reviewer");
    expect(ids).toContain("agent.security-reviewer");
  });

  it("skips code specialists for a pure-CSS change (token saving)", () => {
    const agents = SPECIALISTS.map(s => makeSpecialistDefinition(s));
    const p = plan({ diff: cssDiff, agents });
    // No code-shaped specialists should run for a CSS-only change.
    expect(p.selected.map((s) => s.id)).not.toContain("agent.react-reviewer");
    expect(p.selected.map((s) => s.id)).not.toContain("agent.code-reviewer");
    expect(p.skipped.length).toBeGreaterThan(0);
  });

  it("orders selected specialists by descending priority", () => {
    const agents = SPECIALISTS.map(s => makeSpecialistDefinition(s));
    const p = plan({ diff: tsxDiff, agents });
    const priorities = p.selected.map((s) => s.priority);
    const sorted = [...priorities].sort((a, b) => b - a);
    expect(priorities).toEqual(sorted);
  });

  it("skips a specialist whose category is already covered by rules", () => {
    const agents = SPECIALISTS.map(s => makeSpecialistDefinition(s));
    const p = plan({
      diff: tsxDiff,
      agents,
      coveredCategories: ["security"],
    });
    expect(p.selected.map((s) => s.id)).not.toContain("agent.security-reviewer");
    expect(
      p.skipped.some((s) => s.reason.includes("deterministic rules")),
    ).toBe(true);
  });
});

describe("planner: Next.js reviewer", () => {
  const nextAgent = {
    id: "agent.nextjs-reviewer",
    name: "Next.js Reviewer",
    goal: "x",
    focus: "nextjs",
    priority: 60,
    preferredTier: "mid",
  } as any;
  const mk = (file: string, line: string) =>
    `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -0,0 +1 @@\n+${line}\n`;

  it("skips a plain React app that only has an app/ folder", () => {
    const r = plan({
      diff: mk("src/app/App.tsx", 'import { useState } from "react";'),
      agents: [nextAgent],
    });
    expect(r.selected).toHaveLength(0);
  });

  it("selects it for real Next.js code", () => {
    const r = plan({
      diff: mk("src/Nav.tsx", 'import Link from "next/link";'),
      agents: [nextAgent],
    });
    expect(r.selected).toHaveLength(1);
  });
});
