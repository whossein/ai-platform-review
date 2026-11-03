import { describe, it, expect } from "vitest";
import { fetchChangeRequestMeta } from "./meta.js";

const json = (body: unknown, ok = true) =>
  (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;

describe("fetchChangeRequestMeta", () => {
  it("reads the GitLab MR author", async () => {
    const meta = await fetchChangeRequestMeta(
      "https://gitlab.example.com/g/p/-/merge_requests/7",
      { GITLAB_TOKEN: "t" },
      json({
        title: "Add x",
        source_branch: "feat/x",
        target_branch: "main",
        author: { username: "ali", name: "Ali R", avatar_url: "a", web_url: "w" },
      }),
    );
    expect(meta?.author).toEqual({ username: "ali", name: "Ali R", avatarUrl: "a", profileUrl: "w" });
    expect(meta?.sourceBranch).toBe("feat/x");
  });

  it("reads the GitHub PR author", async () => {
    const meta = await fetchChangeRequestMeta(
      "https://github.com/o/r/pull/3",
      {},
      json({ title: "T", head: { ref: "h" }, base: { ref: "b" }, user: { login: "bob" } }),
    );
    expect(meta?.author?.username).toBe("bob");
    expect(meta?.targetBranch).toBe("b");
  });

  it("returns undefined on HTTP failure or network error", async () => {
    expect(await fetchChangeRequestMeta("https://github.com/o/r/pull/3", {}, json({}, false))).toBeUndefined();
    const boom = (async () => { throw new Error("x"); }) as unknown as typeof fetch;
    expect(await fetchChangeRequestMeta("https://github.com/o/r/pull/3", {}, boom)).toBeUndefined();
    expect(await fetchChangeRequestMeta("not a url", {})).toBeUndefined();
  });
});
