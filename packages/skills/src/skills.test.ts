import { describe, it, expect } from "vitest";
import type {
  ContextSlice,
  ContextHandle,
  ContentHash,
  SkillId,
} from "@ai-review/core";
import {
  contributingComplianceSkill,
  analyzeImportsSkill,
  inspectSymbolSkill,
  diffAnalysisSkill,
  createDefaultSkillRegistry,
  createSkillAccessor,
} from "./index.js";

/** Creates a dummy ContextSlice for testing skills independently. */
function makeDummyContextSlice(): ContextSlice {
  return {
    handle: "ctx.test.123" as ContextHandle,
    version: 1,
    compressed: false,
    estimatedTokens: 300,
    rendered: "DUMMY_RENDERED_SLICE",
    files: [
      {
        path: "src/components/UserButton.tsx",
        hash: "hash.123" as ContentHash,
        changed: true,
        imports: ["react", "../../../legacy/utils.js", "child_process"],
        exports: ["UserButton", "useButtonState"],
        symbols: [
          {
            name: "useButtonState",
            kind: "hook",
            location: { file: "src/components/UserButton.tsx", line: 5 },
            signature: "function useButtonState(initial: boolean)",
            changed: true,
          },
          {
            name: "UserButton",
            kind: "component",
            location: { file: "src/components/UserButton.tsx", line: 15 },
            signature: "function UserButton(props: Props)",
            changed: true,
          },
        ],
      },
      {
        path: "src/auth/service.ts",
        hash: "hash.456" as ContentHash,
        changed: true,
        imports: ["crypto", "./config.js"],
        exports: ["AuthService"],
        symbols: [
          {
            name: "AuthService",
            kind: "class",
            location: { file: "src/auth/service.ts", line: 10 },
            signature: "class AuthService",
            changed: true,
          },
        ],
      },
    ],
  };
}

describe("Skill Registry & Accessor", () => {
  it("registers all 4 standard skills", () => {
    const registry = createDefaultSkillRegistry();
    const list = registry.list();
    expect(list.length).toBe(4);
    const ids = list.map((s) => s.id);
    expect(ids).toContain("skill.governance.contributing-compliance");
    expect(ids).toContain("skill.analysis.imports");
    expect(ids).toContain("skill.code.inspect-symbol");
    expect(ids).toContain("skill.diff.analyze");
  });

  it("handles unknown skill execution gracefully with not_found", async () => {
    const registry = createDefaultSkillRegistry();
    const accessor = createSkillAccessor(registry);
    const res = await accessor.execute({
      skillId: "skill.nonexistent" as SkillId,
      args: {},
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.category).toBe("not_found");
    }
  });
});

describe("contributingComplianceSkill", () => {
  it("does not demand docs or a changelog; flags only provided commit/branch formats", async () => {
    const slice = makeDummyContextSlice();
    const res = await contributingComplianceSkill.execute({
      skillId: contributingComplianceSkill.descriptor.id,
      args: {
        files: slice.files.map((f) => f.path),
        commitMessage: "random commit without convention",
        branchName: "my-branch",
      },
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      const result = res.value.result as any;
      expect(result.compliant).toBe(true);
      expect(result.missingRequirements).toEqual([]);
      expect(result.findings.some((f: { rule: string }) => f.rule === "docs/changelog-entry")).toBe(false);
      expect(result.findings.some((f: { rule: string }) => f.rule === "git/conventional-commit")).toBe(true);
      expect(result.findings.some((f: { rule: string }) => f.rule === "git/branch-naming")).toBe(true);
    }
  });

  it("passes when changelog and conventional commit format are present", async () => {
    const res = await contributingComplianceSkill.execute({
      skillId: contributingComplianceSkill.descriptor.id,
      args: {
        files: ["src/app.ts", "CHANGELOG.md"],
        commitMessage: "feat(core): add new symbol extractor",
        branchName: "feat/symbol-extractor",
      },
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      const result = res.value.result as any;
      expect(result.compliant).toBe(true);
      expect(result.missingRequirements.length).toBe(0);
      expect(result.score).toBe(100);
    }
  });
});

describe("contributingComplianceSkill without commit or branch", () => {
  it("reports no findings for code changes without docs", async () => {
    const res = await contributingComplianceSkill.execute({
      skillId: contributingComplianceSkill.descriptor.id,
      args: { files: ["src/app.ts"], diff: "+x" },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const result = res.value.result as { compliant: boolean; score: number; findings: unknown[] };
      expect(result.compliant).toBe(true);
      expect(result.score).toBe(100);
      expect(result.findings).toEqual([]);
    }
  });
});

describe("analyzeImportsSkill", () => {
  it("detects sensitive system packages and deep relative imports from ContextSlice", async () => {
    const slice = makeDummyContextSlice();
    const res = await analyzeImportsSkill.execute({
      skillId: analyzeImportsSkill.descriptor.id,
      args: { slice },
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      const result = res.value.result as any;
      expect(result.totalImports).toBe(5);
      expect(result.externalPackages).toContain("child_process");
      expect(result.externalPackages).toContain("react");
      expect(result.externalPackages).toContain("crypto");

      // Verify issues detected
      const deepIssue = result.issues.find(
        (i: any) => i.rule === "imports/deep-relative-traversal"
      );
      expect(deepIssue).toBeDefined();

      const sensitiveIssue = result.issues.find(
        (i: any) => i.rule === "imports/sensitive-system-package"
      );
      expect(sensitiveIssue).toBeDefined();
    }
  });
});

describe("inspectSymbolSkill", () => {
  it("extracts and classifies hooks, components, classes from ContextSlice", async () => {
    const slice = makeDummyContextSlice();
    const res = await inspectSymbolSkill.execute({
      skillId: inspectSymbolSkill.descriptor.id,
      args: { slice },
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      const result = res.value.result as any;
      expect(result.totalSymbols).toBe(3);
      expect(result.changedSymbols.length).toBe(3);
      expect(result.classifications.hooks.length).toBe(1);
      expect(result.classifications.hooks[0].name).toBe("useButtonState");
      expect(result.classifications.components.length).toBe(1);
      expect(result.classifications.components[0].name).toBe("UserButton");
      expect(result.classifications.classes.length).toBe(1);
      expect(result.classifications.classes[0].name).toBe("AuthService");
    }
  });
});

describe("diffAnalysisSkill", () => {
  it("computes churn metrics and identifies sensitive security/auth files", async () => {
    const rawDiff = `diff --git a/src/auth/service.ts b/src/auth/service.ts
--- a/src/auth/service.ts
+++ b/src/auth/service.ts
@@ -1,3 +1,6 @@
+const passwordHash = "abc";
+function verifyPassword() { return true; }
`;
    const res = await diffAnalysisSkill.execute({
      skillId: diffAnalysisSkill.descriptor.id,
      args: { diff: rawDiff },
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      const result = res.value.result as any;
      expect(result.filesChanged).toBe(1);
      expect(result.linesAdded).toBe(2);
      expect(result.linesDeleted).toBe(0);
      expect(result.sensitiveFiles).toContain("src/auth/service.ts");
      expect(result.riskLevel).toBe("high");
    }
  });

  it("reports the same counts for a diff annotated with line numbers", async () => {
    const annotated = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,3 +1,3 @@",
      "     1 const a = 1;",
      "      -const b = 2;",
      "     2+const b = 3;",
      "     3+// --- a comment",
      "",
    ].join("\n");
    const res = await diffAnalysisSkill.execute({
      skillId: diffAnalysisSkill.descriptor.id,
      args: { diff: annotated },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const result = res.value.result as Record<string, unknown>;
      expect(result.filesChanged).toBe(1);
      expect(result.linesAdded).toBe(2);
      expect(result.linesDeleted).toBe(1);
    }
  });
});

describe("diffAnalysisSkill project_structure bullets", () => {
  it("counts '- path' bullets as deleted only when they are part of the diff", async () => {
    const run = (diff: string) =>
      diffAnalysisSkill.execute({ skillId: diffAnalysisSkill.descriptor.id, args: { diff } });
    const raw = "+++ b/a.ts\n+a";
    const rendered = `<project_structure>\n- x\n</project_structure>\n${raw}`;
    const a = await run(raw);
    const b = await run(rendered);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect((a.value.result as { linesDeleted: number }).linesDeleted).toBe(0);
      // Documents why callers must pass the raw diff, not the rendered prompt.
      expect((b.value.result as { linesDeleted: number }).linesDeleted).toBe(1);
    }
  });
});
