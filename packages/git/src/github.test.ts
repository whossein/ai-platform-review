import { describe, it, expect } from "vitest";
import type { AsyncResult, ChangeRequestRef } from "@ai-review/core";
import type { HttpClient, HttpRequest, HttpResponse } from "./http.js";
import { GitHubProvider } from "./github.js";

const REF: ChangeRequestRef = { provider: "github", projectId: "o/r", id: "7" };

class Fake implements HttpClient {
  readonly requests: HttpRequest[] = [];
  constructor(private readonly routes: (r: HttpRequest) => HttpResponse) {}
  async send(req: HttpRequest): AsyncResult<HttpResponse> {
    this.requests.push(req);
    return { ok: true, value: this.routes(req) };
  }
}

describe("GitHubProvider", () => {
  it("posts an inline review comment at the PR head sha", async () => {
    const http = new Fake((r) =>
      r.method === "GET"
        ? { status: 200, body: { head: { sha: "abc" } } }
        : { status: 201, body: { id: 5, body: "hi" } },
    );
    const p = new GitHubProvider(http, { baseUrl: "https://github.com", token: "t" });
    const res = await p.createDiscussion(REF, "hi", { file: "a.ts", line: 3 });
    expect(res.ok).toBe(true);
    const post = http.requests[1]!;
    expect(post.url).toBe("https://api.github.com/repos/o/r/pulls/7/comments");
    expect(post.body).toMatchObject({ commit_id: "abc", path: "a.ts", line: 3, side: "RIGHT" });
  });

  it("falls back to a plain PR comment when the line is rejected", async () => {
    const http = new Fake((r) => {
      if (r.method === "GET") return { status: 200, body: { head: { sha: "abc" } } };
      if (r.url.endsWith("/pulls/7/comments")) return { status: 422, body: { message: "bad line" } };
      return { status: 201, body: { id: 6, body: "x" } };
    });
    const p = new GitHubProvider(http, { baseUrl: "https://github.com", token: "t" });
    const res = await p.createDiscussion(REF, "hi", { file: "a.ts", line: 99 });
    expect(res.ok).toBe(true);
    expect(http.requests.at(-1)!.url).toBe("https://api.github.com/repos/o/r/issues/7/comments");
  });

  it("uses /api/v3 for GitHub Enterprise", async () => {
    const http = new Fake(() => ({ status: 200, body: [] }));
    const p = new GitHubProvider(http, { baseUrl: "https://ghe.acme.com", token: "t" });
    await p.listDiscussions(REF);
    expect(http.requests[0]!.url).toContain("https://ghe.acme.com/api/v3/repos/o/r/pulls/7/comments");
  });
});
