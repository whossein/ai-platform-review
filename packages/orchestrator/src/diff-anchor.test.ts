import { describe, it, expect } from "vitest";
import type { AgentId, ContentHash, Issue, IssueId } from "@ai-review/core";
import { annotateDiffLineNumbers, anchorIssues } from "./diff-anchor.js";

const DIFF = [
  "# Target Branch: main",
  "diff --git a/src/a.ts b/src/a.ts",
  "index 111..222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -10,3 +10,4 @@",
  " const a = 1;",
  "+const b = 2;",
  "-const c = 3;",
  " return a;",
  " // end",
  "@@ -40,2 +41,3 @@ fn",
  " x();",
  "+y();",
  "+z();",
  "diff --git a/src/new.ts b/src/new.ts",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/src/new.ts",
  "@@ -0,0 +1,2 @@",
  "+export const n = 1;",
  "+export const m = 2;",
  "diff --git a/src/old.ts b/src/old.ts",
  "deleted file mode 100644",
  "--- a/src/old.ts",
  "+++ /dev/null",
  "@@ -1,2 +0,0 @@",
  "-gone();",
  "-gone2();",
].join("\n");

function issue(
  file: string,
  line: number | undefined,
  confidence = 0.9,
): Issue {
  return {
    id: "i.1" as IssueId,
    title: "t",
    description: "d",
    severity: "high",
    confidence,
    reason: "r",
    suggestion: { description: "fix" },
    location: line === undefined ? { file } : { file, line, endLine: line + 1 },
    references: [],
    category: "code",
    producedBy: "agent.x" as AgentId,
    fingerprint: "fp" as ContentHash,
  };
}

describe("annotateDiffLineNumbers", () => {
  const out = annotateDiffLineNumbers(DIFF).split("\n");

  it("leaves headers and hunk markers unchanged", () => {
    expect(out[0]).toBe("# Target Branch: main");
    expect(out[1]).toBe("diff --git a/src/a.ts b/src/a.ts");
    expect(out[3]).toBe("--- a/src/a.ts");
    expect(out[4]).toBe("+++ b/src/a.ts");
    expect(out[5]).toBe("@@ -10,3 +10,4 @@");
  });

  it("numbers added and context lines, pads removed lines", () => {
    expect(out.slice(6, 11)).toEqual([
      "    10 const a = 1;",
      "    11+const b = 2;",
      "      -const c = 3;",
      "    12 return a;",
      "    13 // end",
    ]);
    expect(out.slice(12, 15)).toEqual([
      "    41 x();",
      "    42+y();",
      "    43+z();",
    ]);
  });

  it("handles new and deleted files", () => {
    expect(out[19]).toBe("@@ -0,0 +1,2 @@");
    expect(out[20]).toBe("     1+export const n = 1;");
    expect(out[21]).toBe("     2+export const m = 2;");
    expect(out[22]).toBe("diff --git a/src/old.ts b/src/old.ts");
    expect(out[26]).toBe("@@ -1,2 +0,0 @@");
    expect(out[27]).toBe("      -gone();");
  });

  it("does not mistake removed '--' content for a file header", () => {
    const d = "--- a/x\n+++ b/x\n@@ -1,2 +1,1 @@\n--- note\n+ok";
    expect(annotateDiffLineNumbers(d).split("\n").slice(3)).toEqual([
      "      --- note",
      "     1+ok",
    ]);
  });

  it("is deterministic", () => {
    expect(annotateDiffLineNumbers(DIFF)).toBe(annotateDiffLineNumbers(DIFF));
  });
});

describe("anchorIssues", () => {
  it("keeps issues on an added line unchanged", () => {
    const [res] = anchorIssues([issue("src/a.ts", 11)], DIFF);
    expect(res?.location.line).toBe(11);
    expect(res?.confidence).toBe(0.9);
  });

  it("snaps to the nearest added line and reduces confidence", () => {
    const [res] = anchorIssues([issue("src/a.ts", 13)], DIFF);
    expect(res?.location.line).toBe(11);
    expect(res?.location.endLine).toBeUndefined();
    expect(res?.confidence).toBe(0.72);
  });

  it("breaks ties toward the earlier line", () => {
    // 42 and 43 are added; 11 and 42 are 31 apart from 26.5 -> use 1 vs 3 gap.
    const [res] = anchorIssues([issue("src/new.ts", 3)], DIFF);
    expect(res?.location.line).toBe(2);
    const [tie] = anchorIssues([issue("src/a.ts", 26)], DIFF);
    expect(tie?.location.line).toBe(11);
  });

  it("matches files regardless of a/ b/ ./ prefixes", () => {
    expect(anchorIssues([issue("./src/a.ts", 11)], DIFF)).toHaveLength(1);
    expect(anchorIssues([issue("b/src/a.ts", 11)], DIFF)).toHaveLength(1);
  });

  it("drops issues for files not in the diff", () => {
    expect(anchorIssues([issue("src/other.ts", 1)], DIFF)).toEqual([]);
  });

  it("keeps issues on files outside the diff that the prompt referenced", () => {
    const kept = anchorIssues(
      [issue("src/caller.ts", 7), issue("src/ghost.ts", 1)],
      DIFF,
      (path) => path === "src/caller.ts",
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]?.location).toMatchObject({ file: "src/caller.ts", line: 7 });
    expect(kept[0]?.confidence).toBeLessThan(issue("src/caller.ts", 7).confidence);
  });

  it("handles deletion-only files by hunk range", () => {
    const pure = [
      "diff --git a/src/b.ts b/src/b.ts",
      "--- a/src/b.ts",
      "+++ b/src/b.ts",
      "@@ -5,3 +5,2 @@",
      " keep();",
      "-removed();",
      " keep2();",
    ].join("\n");
    const [kept] = anchorIssues([issue("src/b.ts", 6)], pure);
    expect(kept?.location.line).toBe(6);
    expect(kept?.confidence).toBe(0.9);
    expect(anchorIssues([issue("src/b.ts", 99)], pure)).toEqual([]);
    expect(anchorIssues([issue("src/old.ts", 1)], DIFF)).toEqual([]);
  });

  it("does not mutate the input issues", () => {
    const input = issue("src/a.ts", 13);
    anchorIssues([input], DIFF);
    expect(input.location.line).toBe(13);
  });
});
