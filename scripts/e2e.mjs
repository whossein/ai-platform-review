#!/usr/bin/env node
/**
 * End-to-end smoke test (run `npm run build && npm run e2e`).
 *
 * Boots the built server (dist/server.cjs) in a temp directory against a fake
 * GitLab and a fake OpenAI-compatible LLM, then checks the main product flow:
 * MR URL -> auto-registered project -> multi-agent review -> index ->
 * index-aware review context -> RBAC for non-admin users.
 */
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = path.join(ROOT, "dist", "server.cjs");
if (!existsSync(SERVER)) {
  console.error("dist/server.cjs not found - run `npm run build` first.");
  process.exit(2);
}

const FILES = {
  "src/db.ts": "import { conn } from './conn';\nexport function q(id: string) {\n  return conn.query(`SELECT * FROM users WHERE id = ${id}`);\n}\n",
  "src/conn.ts": "export const conn = { query: (s: string) => s };\n",
  "src/app.ts": "import { q } from './db';\nimport { conn } from './conn';\nexport const run = () => q('1') && conn;\n",
};

const listen = (handler) =>
  new Promise((resolve) => {
    const s = http.createServer(handler);
    s.listen(0, "127.0.0.1", () => resolve(s));
  });
const send = (res, obj, status = 200) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
};

const llmPrompts = [];
const llm = await listen((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    try {
      const messages = JSON.parse(body).messages ?? [];
      llmPrompts.push(messages.map((m) => String(m.content)).join("\n"));
    } catch {}
    send(res, {
      id: "fake",
      model: "fake",
      choices: [{ message: { role: "assistant", content: JSON.stringify({ issues: [{ title: "SQL injection", description: "id interpolated into SQL", severity: "high", confidence: 0.9, reason: "string-built query", suggestion: "use params", file: "src/db.ts", line: 3, category: "security" }], confidence: 0.9, summary: "ok" }) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    });
  });
});
const gitlab = await listen((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/merge_requests/7/diffs")) {
    const diff = "@@ -0,0 +1,4 @@\n" + FILES["src/db.ts"].split("\n").filter(Boolean).map((l) => "+" + l).join("\n") + "\n";
    return send(res, [{ old_path: "src/db.ts", new_path: "src/db.ts", new_file: true, diff }]);
  }
  if (p === "/api/v4/projects/team/app") return send(res, { default_branch: "main" });
  if (p.endsWith("/repository/branches")) return send(res, [{ name: "feature/x" }, { name: "main" }, { name: "develop" }]);
  if (p.endsWith("/repository/commits/main")) return send(res, { id: "a".repeat(40) });
  if (p.endsWith("/repository/tree")) return send(res, Object.keys(FILES).map((f, i) => ({ type: "blob", path: f, id: "blob" + i })));
  const m = /\/repository\/files\/(.+)\/raw$/.exec(p);
  if (m && FILES[m[1]]) {
    res.writeHead(200, { "content-type": "text/plain" });
    return res.end(FILES[m[1]]);
  }
  send(res, { message: "not found" }, 404);
});

const gl = `http://127.0.0.1:${gitlab.address().port}`;
const llmUrl = `http://127.0.0.1:${llm.address().port}/v1`;
const port = 39000 + Math.floor(Math.random() * 900);
const base = `http://127.0.0.1:${port}`;
const cwd = mkdtempSync(path.join(os.tmpdir(), "ai-review-e2e-"));
const srv = spawn("node", [SERVER, "--port", String(port)], { cwd, env: { ...process.env, NODE_ENV: "production" }, stdio: "ignore" });

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` ${detail}`}`);
  if (!ok) failures.push(name);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (method, url, body, token) => {
  const r = await fetch(base + url, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const waitIndex = async (pid, token) => {
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    const s = (await api("GET", `/api/projects/${pid}/index`, null, token)).body;
    if (s.job && !["queued", "running"].includes(s.job.status)) return s;
  }
  return undefined;
};

try {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(base + "/api/health")).ok) break; } catch {}
    await sleep(200);
  }
  const setup = await api("POST", "/api/auth/setup", { name: "Admin", email: "a@x.io", password: "AdminPass123!", passwordConfirmation: "AdminPass123!" });
  check("first-run admin setup", setup.status === 201, JSON.stringify(setup.body));
  const admin = (await api("POST", "/api/auth/login", { email: "a@x.io", password: "AdminPass123!" })).body.token;
  check("unauthenticated review is rejected", (await api("POST", "/api/review", { diff: "x" })).status === 401);

  const env = { AI_REVIEW_LLM_PROVIDER: "custom", AI_REVIEW_LLM_BASE_URL: llmUrl, AI_REVIEW_LLM_API_KEY: "k" };
  const mr = `${gl}/team/app/-/merge_requests/7`;

  const r1 = await api("POST", "/api/review", { diff: mr, env }, admin);
  check("review from MR URL succeeds", r1.status === 200, JSON.stringify(r1.body));
  check("project auto-registered from URL", r1.body.project?.repositoryPath === "team/app" && r1.body.mergeRequest?.mrNumber === "7");
  check("multiple specialist agents ran", new Set(llmPrompts.map((p) => /You are the (.+?)\. FOCUS/.exec(p)?.[1])).size >= 2, `prompts=${llmPrompts.length}`);
  check("duplicate findings are consolidated", (r1.body.issues ?? []).filter((i) => /sql/i.test(i.title)).length === 1);
  check("cache metrics are reported", typeof r1.body.metrics?.cacheMisses === "number" && r1.body.metrics.cacheMisses > 0, JSON.stringify(r1.body.metrics));

  const list = await api("GET", "/api/projects", null, admin);
  const pid = list.body.projects?.[0]?.id;
  check("project listed with one MR", list.body.projects?.length === 1 && list.body.projects[0].mergeRequestCount === 1);

  const first = await waitIndex(pid, admin);
  check("auto-index ran after first review", first?.job?.status === "succeeded" && first.index?.stats.indexedFilesCount === 3, JSON.stringify(first?.job));

  llmPrompts.length = 0;
  const r2 = await api("POST", "/api/review", { diff: mr, env: { ...env, AI_REVIEW_LLM_MODEL: "other-model" } }, admin);
  check("second review succeeds without duplicating project/MR", r2.status === 200 && (await api("GET", `/api/projects/${pid}`, null, admin)).body.reviews?.length === 2);
  check("index context reaches the reviewers", llmPrompts.some((p) => p.includes("PROJECT STRUCTURE") && p.includes("src/app.ts")), `prompts=${llmPrompts.length}`);

  const br = await api("GET", `/api/projects/${pid}/index/branches`, null, admin);
  check("branch list has the default branch first", br.body.defaultBranch === "main" && JSON.stringify(br.body.branches) === JSON.stringify(["main", "develop", "feature/x"]), JSON.stringify(br.body));

  const re = await api("POST", `/api/projects/${pid}/index`, {}, admin);
  check("manual re-index accepted", re.status === 202);
  const again = await waitIndex(pid, admin);
  check("re-index reuses unchanged files", again?.index?.stats.reusedFilesCount === 3 && again.index.stats.downloadedFilesCount === 0, JSON.stringify(again?.index?.stats));

  await api("POST", "/api/users", { name: "Mem", email: "m@x.io", password: "MemberPass123!", role: "MEMBER" }, admin);
  const member = (await api("POST", "/api/auth/login", { email: "m@x.io", password: "MemberPass123!" })).body.token;
  check("non-member cannot list branches", (await api("GET", `/api/projects/${pid}/index/branches`, null, member)).status === 403);
  check("non-member cannot read project index", (await api("GET", `/api/projects/${pid}/index`, null, member)).status === 403);
  check("non-member cannot review an existing project", (await api("POST", "/api/review", { diff: mr, env }, member)).status === 403);
  const mr8 = `${gl}/team/other/-/merge_requests/1`;
  const m1 = await api("POST", "/api/review", { diff: mr8, env }, member);
  check("member can review a brand-new URL and owns the project", m1.status !== 403 && (await api("GET", "/api/projects", null, member)).body.projects?.length === 1, `status=${m1.status} ${m1.body.error ?? ""}`);
} catch (e) {
  check("no unexpected exception", false, String(e));
} finally {
  srv.kill();
  gitlab.close();
  llm.close();
  rmSync(cwd, { recursive: true, force: true });
}
console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nAll checks passed");
process.exit(failures.length ? 1 : 0);
