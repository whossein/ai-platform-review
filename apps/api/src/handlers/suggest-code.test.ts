import { describe, it, expect, vi, afterEach } from "vitest";
import {
  codeContextHandler,
  suggestCodeHandler,
  commitSuggestionHandler,
} from "./suggest-code.js";

const MR = "https://gitlab.example.com/grp/proj/-/merge_requests/7";
const FILE = ["a", "b", "c", "d", "e"].join("\n");
const env = { GITLAB_TOKEN: "t", AI_REVIEW_LLM_PROVIDER: "mock" };

function mockFetch(commits: unknown[] = [], fileBody = FILE) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/merge_requests/7")) {
      return new Response(JSON.stringify({ source_branch: "feat", target_branch: "main", state: "opened" }));
    }
    if (url.includes("/repository/files/")) return new Response(fileBody);
    if (url.endsWith("/repository/commits")) {
      commits.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ id: "abc", web_url: "http://x/c/abc" }), { status: 201 });
    }
    return new Response("nope", { status: 404 });
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("suggest-code handlers", () => {
  it("returns a window of lines around the flagged line", async () => {
    vi.stubGlobal("fetch", mockFetch());
    const r = await codeContextHandler({ diff: MR, items: [{ file: "x.ts", line: 3 }], env });
    expect(r.snippets["x.ts|3"]).toEqual({ startLine: 1, lines: ["a", "b", "c", "d", "e"] });
  });

  it("generates a suggestion with the mock provider", async () => {
    vi.stubGlobal("fetch", mockFetch());
    const r = await suggestCodeHandler({
      diff: MR,
      issue: { title: "T", location: { file: "x.ts", line: 2 } },
      env,
    });
    expect(r.sourceBranch).toBe("feat");
    expect(r.startLine).toBe(2);
    expect(r.original).toBe("b");
  });

  it("commits the replaced range to the source branch", async () => {
    const commits: any[] = [];
    vi.stubGlobal("fetch", mockFetch(commits));
    const r = await commitSuggestionHandler({
      diff: MR, file: "x.ts", startLine: 2, endLine: 3, original: "b\nc", code: "B", env,
    });
    expect(r.commitId).toBe("abc");
    expect(commits[0].branch).toBe("feat");
    expect(commits[0].actions[0].content).toBe("a\nB\nd\ne");
  });

  it("refuses to commit when the original lines drifted", async () => {
    vi.stubGlobal("fetch", mockFetch());
    await expect(
      commitSuggestionHandler({ diff: MR, file: "x.ts", startLine: 2, endLine: 2, original: "zzz", code: "B", env }),
    ).rejects.toThrow(/changed/);
  });

  it("rejects path traversal", async () => {
    vi.stubGlobal("fetch", mockFetch());
    await expect(
      commitSuggestionHandler({ diff: MR, file: "../etc/passwd", startLine: 1, endLine: 1, original: "a", code: "B", env }),
    ).rejects.toThrow(/Invalid file path/);
  });
});
