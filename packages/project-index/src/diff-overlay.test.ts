import { describe, expect, it } from "vitest";
import {
  buildReviewContext,
  extractImportSpecifiers,
  parseDiffChanges,
  type ProjectIndexSnapshot,
} from "./index.js";

const file = (path: string, exports: string[] = []) => ({
  path,
  lang: "ts" as const,
  size: 1,
  lineCount: 1,
  contentHash: "h",
  symbols: [],
  imports: [],
  exports,
});

const snapshot: ProjectIndexSnapshot = {
  schemaVersion: 1,
  projectId: "p" as never,
  ref: "main",
  commitSha: "a".repeat(40),
  createdAt: new Date().toISOString(),
  stats: {} as never,
  files: [file("src/util.ts", ["util"]), file("src/old.ts", ["old"]), file("src/app.ts"), file("src/use-old.ts")],
  graph: {
    importsByFile: { "src/app.ts": ["src/util.ts"], "src/use-old.ts": ["src/old.ts"] },
    importedByFile: { "src/util.ts": ["src/app.ts"], "src/old.ts": ["src/use-old.ts"] },
    externalImportsByFile: {},
    workspaces: [],
    pathAliases: {},
  },
};

const DIFF = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,2 +1,4 @@
 import { util } from "./util";
+import { fresh } from "./fresh";
+import { ghost } from "./ghost";
+import React from "react";
diff --git a/src/fresh.ts b/src/fresh.ts
new file mode 100644
--- /dev/null
+++ b/src/fresh.ts
@@ -0,0 +1,2 @@
+import { util } from "./util";
+export const fresh = util;
diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
--- a/src/old.ts
+++ /dev/null
@@ -1,1 +0,0 @@
-export const old = 1;
`;

describe("diff overlay", () => {
  it("classifies added, modified and deleted files and collects added lines", () => {
    const changes = parseDiffChanges(DIFF);
    expect(changes.map((c) => [c.path, c.status])).toEqual([
      ["src/app.ts", "modified"],
      ["src/fresh.ts", "added"],
      ["src/old.ts", "deleted"],
    ]);
    expect(changes[0]!.addedLines).toHaveLength(3);
  });

  it("detects renames without content hunks", () => {
    const [c] = parseDiffChanges(
      "diff --git a/src/a.ts b/src/b.ts\nsimilarity index 100%\nrename from src/a.ts\nrename to src/b.ts\n",
    );
    expect(c).toMatchObject({ status: "renamed", oldPath: "src/a.ts", path: "src/b.ts" });
  });

  it("does not mistake a removed '-- x' line for a file header", () => {
    const changes = parseDiffChanges(
      "diff --git a/a.sql b/a.sql\n--- a/a.sql\n+++ b/a.sql\n@@ -1,2 +1,2 @@\n--- comment\n+++ comment2\n select 1;\n",
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]!.path).toBe("a.sql");
  });

  it("extracts import/require/dynamic import specifiers", () => {
    expect(
      extractImportSpecifiers([
        'import a from "./a"; export * from "./b";',
        "const c = require('./c'); const d = await import('./d');",
        'import "./side-effect";',
      ]).sort(),
    ).toEqual(["./a", "./b", "./c", "./d", "./side-effect"]);
  });

  it("describes new files, new imports, unresolved imports and deleted-but-still-imported files", () => {
    const ctx = buildReviewContext(snapshot, ["src/app.ts", "src/fresh.ts", "src/old.ts"], { diff: DIFF });
    expect(ctx).toContain("src/app.ts:");
    expect(ctx).toContain("adds imports of src/fresh.ts"); // resolved against the file the diff creates
    expect(ctx).toContain("resolve to no known file: ./ghost");
    expect(ctx).not.toContain("react");
    expect(ctx).toContain("src/fresh.ts: NEW file, not in the index; imports src/util.ts");
    expect(ctx).toContain("src/old.ts: DELETED by this change but still imported by 1 untouched file(s): src/use-old.ts");
    expect(ctx).toContain("src/use-old.ts"); // listed as impacted
  });

  it("is unchanged when no diff is given", () => {
    const ctx = buildReviewContext(snapshot, ["src/util.ts"]);
    expect(ctx).toContain("src/util.ts: exports util; imported by 1 file(s): src/app.ts");
    expect(ctx).not.toContain("NEW file");
  });
});
