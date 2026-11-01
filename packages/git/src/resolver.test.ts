import { describe, expect, it } from "vitest";
import { resolveDiffInput, parseDiffToFiles } from "./resolver.js";

describe("parseDiffToFiles", () => {
  it("parses single file additions from unified diff", () => {
    const diff = `--- a/src/index.ts
+++ b/src/index.ts
@@ -0,0 +1,3 @@
+const x = 1;
+const y = 2;
+console.log(x + y);
`;
    const files = parseDiffToFiles(diff);
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe("src/index.ts");
    expect(files[0]?.text).toContain("const x = 1;");
    expect(files[0]?.text).toContain("console.log(x + y);");
  });

  it("parses multiple files from unified diff", () => {
    const diff = `--- a/foo.ts
+++ b/foo.ts
@@ -1,2 +1,2 @@
-hello
+world
--- a/bar.ts
+++ b/bar.ts
@@ -1,1 +1,2 @@
 bar
+baz
`;
    const files = parseDiffToFiles(diff);
    expect(files).toHaveLength(2);
    expect(files[0]?.path).toBe("foo.ts");
    expect(files[1]?.path).toBe("bar.ts");
  });
});

describe("resolveDiffInput", () => {
  it("returns raw diff string untouched when not a URL", async () => {
    const rawDiff = "--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+new";
    const resolved = await resolveDiffInput(rawDiff, {});
    expect(resolved).toBe(rawDiff);
  });

  it("throws error for unsupported URLs", async () => {
    await expect(
      resolveDiffInput("https://example.com/some/random/url", {}),
    ).rejects.toThrow(/Unsupported URL format/);
  });

  it("resolves GitHub PR with mock fetch", async () => {
    const mockDiff = "--- a/app.ts\n+++ b/app.ts\n@@ -1 +1 @@\n-1\n+2";
    const mockPr = {
      title: "Add feature X",
      head: { ref: "feature-x" },
      base: { ref: "main" },
    };

    const mockFetch = (async (url: any) => {
      const urlStr = String(url);
      if (urlStr.endsWith(".diff")) {
        return {
          ok: true,
          status: 200,
          text: async () => mockDiff,
        };
      }
      if (urlStr.includes("api.github.com")) {
        return {
          ok: true,
          status: 200,
          json: async () => mockPr,
        };
      }
      return { ok: false, status: 404 };
    }) as any;

    const resolved = await resolveDiffInput(
      "https://github.com/org/repo/pull/42",
      { GITHUB_TOKEN: "fake-token" },
      mockFetch,
    );

    expect(resolved).toContain("# Pull Request Metadata:");
    expect(resolved).toContain("# Source Branch: feature-x");
    expect(resolved).toContain("# Target Branch: main");
    expect(resolved).toContain("# PR Title: Add feature X");
    expect(resolved).toContain(mockDiff);
  });

  it("resolves GitLab MR with mock fetch", async () => {
    const mockDiffChanges = [
      {
        old_path: "app.ts",
        new_path: "app.ts",
        diff: "@@ -1 +1 @@\n-1\n+2",
      },
    ];
    const mockMr = {
      title: "Fix bug Y",
      source_branch: "bugfix-y",
      target_branch: "master",
    };

    const mockFetch = (async (url: any) => {
      const urlStr = String(url);
      if (urlStr.endsWith("/diffs")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockDiffChanges),
        };
      }
      if (urlStr.includes("/merge_requests/123")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockMr),
        };
      }
      return {
        ok: false,
        status: 404,
        text: async () => "Not Found",
      };
    }) as any;

    const resolved = await resolveDiffInput(
      "https://gitlab.com/group/project/-/merge_requests/123",
      { GITLAB_TOKEN: "fake-gl-token" },
      mockFetch,
    );

    expect(resolved).toContain("# Merge Request Metadata:");
    expect(resolved).toContain("# Source Branch: bugfix-y");
    expect(resolved).toContain("# Target Branch: master");
    expect(resolved).toContain("# MR Title: Fix bug Y");
    expect(resolved).toContain("--- a/app.ts");
    expect(resolved).toContain("+++ b/app.ts");
    expect(resolved).toContain("-1\n+2");
  });
});

describe("resolveDiffInput latest MR", () => {
  it("fails loudly instead of fabricating a diff when the latest MR cannot be resolved", async () => {
    const failingFetch = (async () =>
      new Response("{}", { status: 404 })) as unknown as typeof fetch;
    await expect(
      resolveDiffInput(
        "https://gitlab.example.com/team/app/-/merge_requests/latest",
        {},
        failingFetch,
      ),
    ).rejects.toThrow(/latest open merge request/);
  });
});
