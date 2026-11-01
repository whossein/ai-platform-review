/**
 * Suggest-code handlers — show the flagged code, ask the LLM for a corrected
 * snippet, and commit that snippet to the merge request's source branch.
 *
 * All three operate on a GitLab MR URL (the same input as `publish`). The file
 * content is read from the MR *source* branch, so line numbers match what the
 * reviewer saw. Committing re-checks the original lines first, so a stale
 * suggestion can never overwrite code that changed in the meantime.
 */

import {
  FetchHttpClient,
  GitLabProvider,
  resolveDiffInput,
  baseUrlFromChangeRequestUrl,
  parseChangeRequestUrl,
} from "@ai-review/git";
import { providersFromEnv } from "@ai-review/llm";

const CONTEXT_RADIUS = 15;
const MAX_REPLACE_LINES = 60;

export interface CodeContextItem {
  readonly file: string;
  readonly line?: number;
}

export interface CodeContextSnippet {
  readonly startLine: number;
  readonly lines: readonly string[];
}

export interface CodeContextRequest {
  readonly diff: string; // MR URL
  readonly items: readonly CodeContextItem[];
  readonly env?: Record<string, string>;
}

export interface CodeContextResponse {
  success: boolean;
  /** Keyed by `file|line`; entries that could not be loaded are omitted. */
  snippets: Record<string, CodeContextSnippet>;
  /** Why a file has no snippet, keyed by file path. */
  errors: Record<string, string>;
  /** Link to the file/line on the Git host, keyed by `file|line`. */
  links: Record<string, string>;
}

export interface SuggestCodeRequest {
  readonly diff: string; // MR URL
  readonly issue: {
    readonly title: string;
    readonly description?: string;
    readonly reason?: string;
    readonly severity?: string;
    readonly location: CodeContextItem;
    readonly suggestion?: { readonly description?: string; readonly patch?: string };
  };
  readonly env?: Record<string, string>;
}

export interface SuggestCodeResponse {
  success: boolean;
  file: string;
  language: string;
  /** 1-based inclusive range of the original lines the snippet replaces. */
  startLine: number;
  endLine: number;
  original: string;
  code: string;
  explanation: string;
  sourceBranch: string;
}

export interface CommitSuggestionRequest {
  readonly diff: string; // MR URL
  readonly file: string;
  readonly startLine: number;
  readonly endLine: number;
  /** The original lines the suggestion was generated for; must still match. */
  readonly original: string;
  readonly code: string;
  readonly message?: string;
  readonly env?: Record<string, string>;
}

export interface CommitSuggestionResponse {
  success: boolean;
  commitId?: string;
  webUrl?: string;
  branch: string;
}

interface GitLabCtx {
  readonly ref: NonNullable<ReturnType<typeof parseChangeRequestUrl>>;
  readonly baseUrl: string;
  readonly token: string;
  readonly sourceBranch: string;
}

async function resolveGitLab(
  mrUrl: string,
  env: Record<string, string>,
): Promise<GitLabCtx> {
  if (!mrUrl || typeof mrUrl !== "string") {
    throw new Error('field "diff" (Merge Request URL) is required');
  }
  const ref = parseChangeRequestUrl(mrUrl);
  if (!ref) {
    throw new Error(
      "A Merge Request URL is required. Start the review from an MR URL to use this feature.",
    );
  }
  if (ref.provider !== "gitlab") {
    throw new Error(`Provider ${ref.provider} is not currently supported for this action`);
  }
  const merged = { ...process.env, ...env } as Record<string, string | undefined>;
  const token = merged["GITLAB_TOKEN"] || merged["GIT_TOKEN"];
  if (!token) throw new Error("GITLAB_TOKEN is not configured in settings or environment");
  const baseUrl = (
    merged["GITLAB_BASE_URL"] ||
    baseUrlFromChangeRequestUrl(mrUrl) ||
    "https://gitlab.com"
  ).replace(/\/+$/, "");

  const provider = new GitLabProvider(new FetchHttpClient(), { baseUrl, token });
  const mr = await provider.getChangeRequest(ref);
  if (mr.ok === false) throw new Error(mr.error.message || "Could not load the merge request");
  if (!mr.value.sourceBranch) throw new Error("Merge request has no source branch");
  return { ref, baseUrl, token, sourceBranch: mr.value.sourceBranch };
}

function filePath(file: string): string {
  const clean = file.replace(/^\/+/, "");
  if (!clean || clean.split("/").includes("..")) throw new Error(`Invalid file path: ${file}`);
  return clean;
}

async function fetchRawFile(ctx: GitLabCtx, file: string): Promise<string> {
  const project = encodeURIComponent(ctx.ref.projectId);
  const url =
    `${ctx.baseUrl}/api/v4/projects/${project}/repository/files/` +
    `${encodeURIComponent(filePath(file))}/raw?ref=${encodeURIComponent(ctx.sourceBranch)}`;
  const res = await fetch(url, { headers: { "private-token": ctx.token } });
  if (!res.ok) {
    throw new Error(`Could not read ${file} from branch ${ctx.sourceBranch} (HTTP ${res.status})`);
  }
  return await res.text();
}

function splitLines(content: string): { lines: string[]; eol: string } {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  return { lines: content.split(/\r?\n/), eol };
}

function windowAround(total: number, line: number | undefined) {
  const center = Math.min(Math.max(line ?? 1, 1), Math.max(total, 1));
  const start = Math.max(1, center - CONTEXT_RADIUS);
  const end = Math.min(total, center + CONTEXT_RADIUS);
  return { start, end };
}

const EXT_LANG: Record<string, string> = {
  ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", py: "python",
  go: "go", java: "java", kt: "kotlin", rb: "ruby", php: "php", cs: "csharp",
  rs: "rust", c: "c", h: "c", cpp: "cpp", swift: "swift", sql: "sql",
  sh: "bash", yml: "yaml", yaml: "yaml", json: "json", html: "html", css: "css",
};

function languageOf(file: string): string {
  return EXT_LANG[file.split(".").pop()?.toLowerCase() ?? ""] ?? "text";
}

/** Cuts lines around `line` out of a unified diff (new-file numbering). */
function snippetFromDiff(
  diff: string,
  file: string,
  line: number | undefined,
): CodeContextSnippet | undefined {
  const rows: { n: number; text: string }[] = [];
  let inFile = false;
  let n = 0;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("+++ ")) {
      inFile = raw.slice(4).replace(/^b\//, "").trim() === file;
      continue;
    }
    if (!inFile) continue;
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(raw);
    if (hunk) {
      n = Number(hunk[1]);
      continue;
    }
    if (raw.startsWith("-") || raw.startsWith("\\")) continue;
    if (raw.startsWith("+") || raw.startsWith(" ")) rows.push({ n: n++, text: raw.slice(1) });
  }
  const target = line ?? rows[0]?.n;
  if (target === undefined) return undefined;
  const near = rows.filter((r) => Math.abs(r.n - target) <= 6);
  return near.length ? { startLine: near[0]!.n, lines: near.map((r) => r.text) } : undefined;
}

export async function codeContextHandler(
  request: CodeContextRequest,
): Promise<CodeContextResponse> {
  const { diff, items, env = {} } = request;
  if (!Array.isArray(items)) throw new Error('field "items" is required');
  const list = items.slice(0, 100);
  const snippets: Record<string, CodeContextSnippet> = {};
  const errors: Record<string, string> = {};
  const links: Record<string, string> = {};
  const mrBase = /^(.*?\/merge_requests\/\d+|.*?\/pull\/\d+)/.exec(diff)?.[1];

  let ctx: GitLabCtx | undefined;
  let ctxError = "";
  try {
    ctx = await resolveGitLab(diff, env);
  } catch (e: any) {
    ctxError = e.message || "Could not reach GitLab";
  }

  const contents = new Map<string, string[]>();
  if (ctx) {
    const c = ctx;
    await Promise.all(
      [...new Set(list.map((i) => i.file))].map(async (f) => {
        try {
          contents.set(f, splitLines(await fetchRawFile(c, f)).lines);
        } catch (e: any) {
          errors[f] = e.message;
        }
      }),
    );
  }

  // Fallback: the same diff the review itself used (may work when the file API does not).
  let reviewDiff: string | undefined;
  const needFallback = list.some((i) => !contents.has(i.file));
  if (needFallback) {
    try {
      reviewDiff = await resolveDiffInput(diff, { ...process.env, ...env } as Record<string, string>);
    } catch {
      // no fallback available
    }
  }

  for (const item of list) {
    const key = `${item.file}|${item.line ?? ""}`;
    if (ctx) {
      const projectPath = decodeURIComponent(ctx.ref.projectId);
      links[key] =
        `${ctx.baseUrl}/${projectPath}/-/blob/${encodeURIComponent(ctx.sourceBranch)}/` +
        `${item.file.split("/").map(encodeURIComponent).join("/")}${item.line ? `#L${item.line}` : ""}`;
    } else if (mrBase) {
      // No API access: open the MR's changes page instead.
      links[key] = `${mrBase}/${mrBase.includes("/pull/") ? "files" : "diffs"}`;
    }
    const lines = contents.get(item.file);
    if (lines) {
      const { start, end } = windowAround(lines.length, item.line);
      snippets[key] = { startLine: start, lines: lines.slice(start - 1, end) };
      continue;
    }
    const fromDiff = reviewDiff ? snippetFromDiff(reviewDiff, item.file, item.line) : undefined;
    if (fromDiff) {
      snippets[key] = fromDiff;
      delete errors[item.file];
    } else if (!errors[item.file]) {
      errors[item.file] = ctxError || "File is not part of the merge request diff";
    }
  }
  return { success: true, snippets, errors, links };
}

/** Pulls the first JSON object out of an LLM reply, tolerating code fences. */
function parseJsonReply(text: string): any {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced?.[1] ?? text;
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("AI did not return a JSON answer");
  return JSON.parse(candidate.slice(first, last + 1));
}

export async function suggestCodeHandler(
  request: SuggestCodeRequest,
): Promise<SuggestCodeResponse> {
  const { diff, issue, env = {} } = request;
  if (!issue || !issue.location?.file) throw new Error('field "issue" is required');
  const ctx = await resolveGitLab(diff, env);
  const file = issue.location.file;
  const { lines } = splitLines(await fetchRawFile(ctx, file));
  const { start, end } = windowAround(lines.length, issue.location.line);
  const numbered = lines
    .slice(start - 1, end)
    .map((l, i) => `${start + i}| ${l}`)
    .join("\n");

  const merged = { ...process.env, ...env } as Record<string, string | undefined>;
  const provider = providersFromEnv(merged)[0];
  const language = merged["AI_REVIEW_COMMENT_LANGUAGE"] === "fa" ? "Persian (Farsi)" : "English";
  const flagged = issue.location.line ?? start;

  let reply: { startLine: number; endLine: number; code: string; explanation: string };

  if (!provider) {
    // Offline/mock mode: deterministic placeholder so the flow stays testable.
    const target = Math.min(Math.max(flagged, start), end);
    const orig = lines[target - 1] ?? "";
    const indent = /^\s*/.exec(orig)?.[0] ?? "";
    reply = {
      startLine: target,
      endLine: target,
      code: `${indent}// FIXME(mock): ${issue.suggestion?.description || issue.title}\n${orig}`,
      explanation: "Mock provider: configure a real AI provider to get a real fix.",
    };
  } else {
    const model = provider.models()[0]!.id;
    const system = [
      "You are a senior engineer fixing one code-review finding.",
      "You receive a numbered excerpt of a source file and a finding.",
      "Reply with ONLY a JSON object: {\"startLine\":number,\"endLine\":number,\"code\":string,\"explanation\":string}.",
      `startLine..endLine (1-based, inclusive) is the SMALLEST range of the excerpt your code replaces; it must lie inside the excerpt and span at most ${MAX_REPLACE_LINES} lines.`,
      "code is the exact replacement for that range: raw source only, no line-number prefixes, no markdown fences, keep the file's indentation and style, change nothing unrelated.",
      `explanation is 1-3 short sentences in ${language} saying what you changed and why.`,
    ].join("\n");
    const user = [
      `File: ${file} (${languageOf(file)})`,
      `Finding (${issue.severity ?? "unknown"}): ${issue.title}`,
      issue.description ? `Description: ${issue.description}` : "",
      issue.reason ? `Why: ${issue.reason}` : "",
      issue.suggestion?.description ? `Suggested direction: ${issue.suggestion.description}` : "",
      `Flagged line: ${flagged}`,
      "",
      "Excerpt:",
      numbered,
    ]
      .filter((s) => s !== "")
      .join("\n");
    const res = await provider.complete({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.2,
      maxTokens: 2000,
    });
    if (res.ok === false) throw new Error(res.error.message || "AI request failed");
    try {
      reply = parseJsonReply(res.value.content);
    } catch {
      throw new Error("AI returned an unreadable answer. Try again.");
    }
  }

  const s = Math.trunc(Number(reply.startLine));
  const e = Math.trunc(Number(reply.endLine));
  if (
    !Number.isFinite(s) || !Number.isFinite(e) ||
    s < start || e > end || e < s || e - s + 1 > MAX_REPLACE_LINES ||
    typeof reply.code !== "string"
  ) {
    throw new Error("AI proposed an invalid line range. Try again.");
  }

  return {
    success: true,
    file,
    language: languageOf(file),
    startLine: s,
    endLine: e,
    original: lines.slice(s - 1, e).join("\n"),
    code: reply.code.replace(/\r?\n$/, ""),
    explanation: String(reply.explanation ?? ""),
    sourceBranch: ctx.sourceBranch,
  };
}

export async function commitSuggestionHandler(
  request: CommitSuggestionRequest,
): Promise<CommitSuggestionResponse> {
  const { diff, file, original, code, env = {} } = request;
  const startLine = Math.trunc(Number(request.startLine));
  const endLine = Math.trunc(Number(request.endLine));
  if (!file || typeof file !== "string") throw new Error('field "file" is required');
  if (typeof code !== "string" || typeof original !== "string") {
    throw new Error('fields "code" and "original" are required');
  }
  if (!(startLine >= 1) || !(endLine >= startLine) || endLine - startLine + 1 > MAX_REPLACE_LINES) {
    throw new Error("Invalid line range");
  }

  const ctx = await resolveGitLab(diff, env);
  const { lines, eol } = splitLines(await fetchRawFile(ctx, file));
  if (endLine > lines.length) throw new Error("Line range is outside the file");
  if (lines.slice(startLine - 1, endLine).join("\n") !== original) {
    throw new Error(
      "The file changed on the source branch since this suggestion was generated. Generate it again.",
    );
  }

  const next = [
    ...lines.slice(0, startLine - 1),
    ...code.split(/\r?\n/),
    ...lines.slice(endLine),
  ].join(eol);

  const project = encodeURIComponent(ctx.ref.projectId);
  const res = await fetch(`${ctx.baseUrl}/api/v4/projects/${project}/repository/commits`, {
    method: "POST",
    headers: { "private-token": ctx.token, "content-type": "application/json" },
    body: JSON.stringify({
      branch: ctx.sourceBranch,
      commit_message:
        request.message?.trim() || `fix: apply AI suggestion to ${filePath(file)}:${startLine}-${endLine}`,
      actions: [{ action: "update", file_path: filePath(file), content: next }],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`GitLab refused the commit (HTTP ${res.status}). ${detail.slice(0, 200)}`);
  }
  const body = (await res.json().catch(() => ({}))) as { id?: string; web_url?: string };
  return {
    success: true,
    ...(body.id ? { commitId: body.id } : {}),
    ...(body.web_url ? { webUrl: body.web_url } : {}),
    branch: ctx.sourceBranch,
  };
}
