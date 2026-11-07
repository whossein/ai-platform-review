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

  it("treats Go, Rust and extension-less files as code for general reviewers", () => {
    const agents = SPECIALISTS.map((s) => makeSpecialistDefinition(s));
    const mk = (path: string, line: string) =>
      `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,1 +1,2 @@\n+${line}\n`;
    for (const [path, line] of [
      ["cmd/main.go", 'import "fmt"'],
      ["src/lib.rs", "fn main() {}"],
      ["docker/Dockerfile", "RUN curl x | sh"],
      ["scripts/deploy.sh", "rm -rf $DIR"],
    ] as const) {
      const ids = plan({ diff: mk(path, line), agents }).selected.map((s) => s.id);
      expect(ids, path).toContain("agent.security-reviewer");
      expect(ids, path).toContain("agent.code-reviewer");
    }
  });

  it("does not select the python reviewer for a Go import", () => {
    const agents = SPECIALISTS.map((s) => makeSpecialistDefinition(s));
    const diff = `diff --git a/main.go b/main.go\n--- a/main.go\n+++ b/main.go\n@@ -1,1 +1,2 @@\n+import fmt\n`;
    const ids = plan({ diff, agents }).selected.map((s) => s.id);
    expect(ids).not.toContain("agent.python-reviewer");
  });

  it("skips security/performance/code reviewers for docs-only changes", () => {
    const agents = SPECIALISTS.map((s) => makeSpecialistDefinition(s));
    const diff = `diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1,1 +1,2 @@\n+hello\n`;
    const ids = plan({ diff, agents }).selected.map((s) => s.id);
    expect(ids).not.toContain("agent.security-reviewer");
    expect(ids).not.toContain("agent.code-reviewer");
  });
});

describe("planner: framework specialists need real evidence", () => {
  const agents = SPECIALISTS.map((s) => makeSpecialistDefinition(s));
  const mkDiff = (files: Array<[string, string]>) =>
    files
      .map(
        ([f, l]) =>
          `diff --git a/${f} b/${f}\n--- a/${f}\n+++ b/${f}\n@@ -0,0 +1 @@\n+${l}\n`,
      )
      .join("");
  const picks = (files: Array<[string, string]>, id: string) =>
    plan({ diff: mkDiff(files), agents }).selected.some((s) => s.id === id);

  const cases: Array<[string, string, Array<[string, string]>, boolean]> = [
    // react
    ["agent.react-reviewer", ".tsx file", [["src/A.tsx", "export const a = 1;"]], true],
    ["agent.react-reviewer", "hook in .ts with react import", [["src/h.ts", 'import { useState } from "react";']], true],
    ["agent.react-reviewer", "JSX self-closing in .js", [["src/a.js", "return <Foo />;"]], true],
    ["agent.react-reviewer", "JSX with props in .ts", [["src/a.ts", "return <Foo bar={1}>x</Foo>;"]], true],
    ["agent.react-reviewer", "Java generic", [["A.java", "List<String> xs;"]], false],
    ["agent.react-reviewer", "Go generic", [["a.go", "var m Map<String>"]], false],
    ["agent.react-reviewer", "TS Promise generic", [["a.ts", "const p: Promise<Foo> = f();"]], false],
    ["agent.react-reviewer", "C include", [["a.c", "#include <Foo.h>"]], false],
    ["agent.react-reviewer", "custom useThing helper without react", [["a.ts", "const x = useThing(1);"]], false],
    // android
    ["agent.android-reviewer", "Kotlin", [["A.kt", "val a = 1"]], true],
    ["agent.android-reviewer", "gradle kts", [["build.gradle.kts", "plugins {}"]], true],
    ["agent.android-reviewer", "manifest", [["app/src/main/AndroidManifest.xml", "<manifest/>"]], true],
    ["agent.android-reviewer", "res xml", [["app/src/main/res/layout/a.xml", "<View/>"]], true],
    ["agent.android-reviewer", "java with androidx import", [["A.java", "import androidx.core.app.X;"]], true],
    ["agent.android-reviewer", "plain java", [["A.java", "class A {}"]], false],
    ["agent.android-reviewer", "pom.xml", [["pom.xml", "<project/>"]], false],
    // ios
    ["agent.ios-reviewer", "swift", [["A.swift", "let a = 1"]], true],
    ["agent.ios-reviewer", "objc .m", [["A.m", "int a;"]], true],
    ["agent.ios-reviewer", "objc++ .mm", [["A.mm", "int a;"]], true],
    ["agent.ios-reviewer", ".h with @interface", [["A.h", "@interface A : NSObject"]], true],
    ["agent.ios-reviewer", ".h with UIKit import", [["A.h", "#import <UIKit/UIKit.h>"]], true],
    ["agent.ios-reviewer", ".h next to .m", [["A.h", "int a;"], ["A.m", "int b;"]], true],
    ["agent.ios-reviewer", "import SwiftUI in non-swift file", [["a.txt", "import SwiftUI"]], true],
    ["agent.ios-reviewer", "plain C header", [["a.h", "int a(void);"]], false],
    // dotnet
    ["agent.dotnet-reviewer", ".cs", [["A.cs", "class A {}"]], true],
    ["agent.dotnet-reviewer", ".csproj", [["A.csproj", "<Project/>"]], true],
    ["agent.dotnet-reviewer", ".sln", [["A.sln", "x"]], true],
    ["agent.dotnet-reviewer", ".cshtml", [["A.cshtml", "<p/>"]], true],
    ["agent.dotnet-reviewer", "using System", [["a.txt", "using System.Linq;"]], true],
    ["agent.dotnet-reviewer", "TS namespace", [["a.ts", "namespace Foo {}"]], false],
    // vue
    ["agent.vue-reviewer", ".vue", [["A.vue", "<template/>"]], true],
    ["agent.vue-reviewer", "import from vue", [["a.ts", 'import { ref } from "vue";']], true],
    ["agent.vue-reviewer", "defineComponent", [["a.ts", "export default defineComponent({})"]], true],
    ["agent.vue-reviewer", "bare ref()", [["a.ts", "const r = ref(1);"]], false],
    ["agent.vue-reviewer", "bare reactive()", [["a.ts", "const r = reactive({});"]], false],
  ];

  it.each(cases)("%s: %s -> %s", (id, _label, files, expected) => {
    expect(picks(files, id)).toBe(expected);
  });
});

describe("planner: Contributing reviewer needs project guidelines", () => {
  const agents = SPECIALISTS.map((s) => makeSpecialistDefinition(s));
  const ids = (hasProjectInstructions?: boolean) =>
    plan({
      diff: tsxDiff,
      agents,
      ...(hasProjectInstructions !== undefined ? { hasProjectInstructions } : {}),
    }).selected.map((a) => a.id as string);

  it("skips it when the project has no guidelines", () => {
    expect(ids(false)).not.toContain("agent.contributing-reviewer");
    expect(ids(false)).toContain("agent.security-reviewer");
  });

  it("runs it with guidelines, or when that is unknown", () => {
    expect(ids(true)).toContain("agent.contributing-reviewer");
    expect(ids()).toContain("agent.contributing-reviewer");
  });
});
