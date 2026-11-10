/**
 * Deterministic rules (ADR-0006) — the platform's #1 cost principle in action.
 *
 * These checks run BEFORE any LLM call. They are free (no tokens), precise, and
 * trustworthy. Their findings are reported next to the specialists' findings;
 * they never replace a specialist (a rule hit must not switch off, say, the
 * security reviewer). Each rule inspects
 * file texts and returns structured `RuleFinding`s.
 *
 * The set here is intentionally deterministic and regex/heuristic based (no
 * external processes). Real ESLint/tsc integrations implement the same `Rule`
 * contract and register alongside these without changing the engine.
 */

import type { Rule, RuleContext, RuleFinding } from "@ai-review/core";
import { ruleMessage } from "./rule-messages.js";

/** Extended context carrying the file texts to scan (offline, no FS access). */
export interface FileRuleContext extends RuleContext {
  readonly files: readonly { readonly path: string; readonly text: string }[];
  /** Saved project guidelines; governance rules read them to know what the project requires. */
  readonly projectInstructions?: string | undefined;
}

function isFileCtx(ctx: RuleContext): ctx is FileRuleContext {
  return Array.isArray((ctx as FileRuleContext).files);
}

/** File-extension groups so rules only run on languages they make sense for. */
const LANG_PATTERNS = {
  js: /\.(?:[cm]?[jt]sx?|vue|svelte)$/i,
  ts: /\.(?:[cm]?tsx?|vue|svelte)$/i,
  py: /\.pyw?$/i,
  java: /\.java$/i,
  cs: /\.cs$/i,
  php: /\.php\d?$/i,
  go: /\.go$/i,
  kt: /\.kts?$/i,
  swift: /\.swift$/i,
  sh: /\.(?:sh|bash|zsh)$/i,
  docker: /(?:^|\/)(?:Dockerfile[^/]*|[^/]+\.dockerfile)$/i,
} as const;
export type RuleLang = keyof typeof LANG_PATTERNS;

function fileMatchesLangs(
  path: string,
  langs: readonly RuleLang[] | undefined,
): boolean {
  return !langs || langs.some((l) => LANG_PATTERNS[l].test(path));
}

/** Documentation files, where comment-looking prefixes (`* item`, `// url`) are content. */
const DOC_FILE = /\.(?:md|mdx|markdown|txt|rst)$/i;

/**
 * True when the whole line is a comment, so code-smell rules can skip it.
 * `#` only counts in languages where it starts a comment (not JS `#private`,
 * C# `#region`, PHP 8 `#[Attr]`) and `--` never in JS (`--i;`).
 */
/**
 * A `debugger` statement: alone on the line or after `;`, `{`, `}`, `)`, followed
 * only by `;`, `}`, whitespace or a trailing comment. Two linear passes instead
 * of one regex with stacked optional `\s*` (ReDoS on long runs of spaces).
 */
function isDebuggerStatement(line: string): boolean {
  const m = /(?:^|[;{})])\s*debugger\b(.*)$/.exec(line);
  if (!m) return false;
  const rest = m[1]!;
  const comment = rest.search(/\/[/*]/);
  return /^[\s;}]*$/.test(comment === -1 ? rest : rest.slice(0, comment));
}

function isCommentLine(line: string, path = ""): boolean {
  if (DOC_FILE.test(path)) return false;
  const t = line.trimStart();
  if (/^(?:\/\/|\/\*|<!--)/.test(t) || /^\*(?:\s|\/|$)/.test(t)) return true;
  if (t.startsWith("#")) {
    return (
      !t.startsWith("#[") &&
      (["py", "sh", "docker", "php"] as const).some((l) =>
        LANG_PATTERNS[l].test(path),
      )
    );
  }
  return /^--(?:\s|$)/.test(t) && !LANG_PATTERNS.js.test(path);
}

/** Runs a per-line matcher across all files, producing findings. */
function scanLines(
  ctx: RuleContext,
  match: (line: string, path: string) => string | undefined,
  make: (path: string, line: number, why: string) => RuleFinding,
  langs?: readonly RuleLang[],
): RuleFinding[] {
  if (!isFileCtx(ctx)) return [];
  const findings: RuleFinding[] = [];
  for (const file of ctx.files) {
    if (!fileMatchesLangs(file.path, langs)) continue;
    const lines = file.text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const why = match(lines[i]!, file.path);
      if (why !== undefined) findings.push(make(file.path, i + 1, why));
    }
  }
  return findings;
}

/** Detects hardcoded secrets / API keys / tokens in added code. */
export const secretDetectionRule: Rule = {
  kind: "secret_detection",
  id: "secret.hardcoded",
  description:
    "Hardcoded API keys, tokens, passwords and private keys in added code.",
  severity: "high",
  async run(ctx) {
    // Known token shapes; all need a left boundary so `disk-usage12345` stays clean.
    const patterns: readonly RegExp[] = [
      /(?<![A-Za-z0-9])sk-(?:proj|ant|svcacct|admin)-[A-Za-z0-9_-]{16,}/, // OpenAI / Anthropic project keys
      /(?<![A-Za-z0-9])sk-[a-zA-Z0-9]{8,}/, // OpenAI-style secret keys
      /(?<![A-Za-z0-9])gh[opsu]_[A-Za-z0-9]{36}/, // GitHub tokens
      /(?<![A-Za-z0-9])github_pat_[A-Za-z0-9_]{22,}/, // GitHub fine-grained PAT
      /(?<![A-Za-z0-9])glpat-[A-Za-z0-9_-]{20}(?![A-Za-z0-9_-])/, // GitLab PAT
      /(?<![A-Za-z0-9])AIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/, // Google API key
      /(?<![A-Za-z0-9])xox[abprs]-[A-Za-z0-9-]{10,}/, // Slack tokens
      /AKIA[0-9A-Z]{16}/, // AWS access key id
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    ];
    const assignment =
      /(?:api[_-]?key|secret|token|password)\s*[:=]\s*(['"])([^'"]{6,})\1/gi;
    // Env references, templates and dummy values are not secrets.
    const placeholder =
      /\$\{|\{\{|^<.*>$|^\$[A-Za-z_]|^%.*%$|process\.env|os\.environ|getenv|change[-_ ]?me|example|^x{3,}|^\*{3,}|^your[-_ ]/i;
    const hasSecret = (line: string): boolean =>
      patterns.some((p) => p.test(line)) ||
      [...line.matchAll(assignment)].some((m) => !placeholder.test(m[2]!));
    return {
      ok: true,
      value: scanLines(
        ctx,
        (line) => (hasSecret(line) ? "matches a secret pattern" : undefined),
        (file, line) => ({
          ruleKind: "secret_detection",
          ruleId: "secret.hardcoded",
          message: ruleMessage("secret.hardcoded", ctx.language),
          location: { file, line },
          severity: "high",
        }),
      ),
    };
  },
};

/** Flags leftover `console.*` debug statements. */
export const noConsoleRule: Rule = {
  kind: "eslint",
  id: "no-console",
  description:
    "Leftover console.log/debug/info/warn/error calls in JavaScript and TypeScript.",
  severity: "low",
  async run(ctx) {
    return {
      ok: true,
      value: scanLines(
        ctx,
        (line, path) =>
          !isCommentLine(line, path) &&
          /\bconsole\.(log|debug|info|warn|error)\s*\(/.test(line)
            ? "console call"
            : undefined,
        (file, line) => ({
          ruleKind: "eslint",
          ruleId: "no-console",
          message: ruleMessage("no-console", ctx.language),
          location: { file, line },
          severity: "low",
        }),
        ["js"],
      ),
    };
  },
};

/** Flags debugger statements. */
export const noDebuggerRule: Rule = {
  kind: "eslint",
  id: "no-debugger",
  description:
    "Leftover debugger statements.",
  severity: "high",
  async run(ctx) {
    return {
      ok: true,
      value: scanLines(
        ctx,
        (line, path) =>
          // A statement: alone on the line (optional `;` / trailing comment) or after `;`, `{`, `}`, `)`.
          !isCommentLine(line, path) &&
          isDebuggerStatement(line)
            ? "debugger statement"
            : undefined,
        (file, line) => ({
          ruleKind: "eslint",
          ruleId: "no-debugger",
          message: ruleMessage("no-debugger", ctx.language),
          location: { file, line },
          severity: "high",
        }),
        ["js"],
      ),
    };
  },
};

/** Flags eval() usage. */
export const noEvalRule: Rule = {
  kind: "eslint",
  id: "no-eval",
  description:
    "eval() (and exec() in Python/PHP) on dynamic input.",
  severity: "critical",
  async run(ctx) {
    return {
      ok: true,
      value: scanLines(
        ctx,
        (line, path) => {
          if (isCommentLine(line, path)) return undefined;
          // `exec(` is only dynamic code/shell execution in Python and PHP; in JS it is usually a callback API.
          const dynamicExec = LANG_PATTERNS.py.test(path) || LANG_PATTERNS.php.test(path);
          const call = dynamicExec ? /(?<![.\w$])(?:eval|exec)\s*\(/ : /(?<![.\w$])eval\s*\(/;
          return call.test(line) ? "eval function" : undefined;
        },
        (file, line) => ({
          ruleKind: "eslint",
          ruleId: "no-eval",
          message: ruleMessage("no-eval", ctx.language),
          location: { file, line },
          severity: "critical",
        }),
        ["js", "py", "php"],
      ),
    };
  },
};

/** Flags skipped or exclusive tests (.only / .skip). */
export const noExclusiveTestsRule: Rule = {
  kind: "eslint",
  id: "no-exclusive-tests",
  description:
    "Exclusive or skipped tests (.only / .skip) that would silently disable other tests.",
  severity: "medium",
  async run(ctx) {
    return {
      ok: true,
      value: scanLines(
        ctx,
        (line, path) =>
          !isCommentLine(line, path) &&
          /\b(describe|it|test)\.(only|skip)\b/.test(line)
            ? "exclusive test"
            : undefined,
        (file, line) => ({
          ruleKind: "eslint",
          ruleId: "no-exclusive-tests",
          message: ruleMessage("no-exclusive-tests", ctx.language),
          location: { file, line },
          severity: "medium",
        }),
        ["js"],
      ),
    };
  },
};

/** Flags use of the `any` type in TypeScript. */
export const noExplicitAnyRule: Rule = {
  kind: "typescript",
  id: "no-explicit-any",
  description:
    "Use of the any type in TypeScript, which disables type checking.",
  severity: "medium",
  async run(ctx) {
    return {
      ok: true,
      value: scanLines(
        ctx,
        (line, path) =>
          !isCommentLine(line, path) &&
          /(:\s*any\b|<any>|as\s+any\b|Array<any>)/.test(line)
            ? "any type"
            : undefined,
        (file, line) => ({
          ruleKind: "typescript",
          ruleId: "no-explicit-any",
          message: ruleMessage("no-explicit-any", ctx.language),
          location: { file, line },
          severity: "medium",
        }),
        ["ts"],
      ),
    };
  },
};

/** Flags `TODO`/`FIXME` markers so they are tracked, not silently shipped. */
export const noTodoRule: Rule = {
  kind: "naming",
  id: "no-todo-comment",
  description:
    "Unresolved TODO / FIXME / XXX markers.",
  severity: "info",
  async run(ctx) {
    return {
      ok: true,
      value: scanLines(
        ctx,
        (line) =>
          /\b(TODO|FIXME|XXX)\b/.test(line) ? "tracking marker" : undefined,
        (file, line) => ({
          ruleKind: "naming",
          ruleId: "no-todo-comment",
          message: ruleMessage("no-todo-comment", ctx.language),
          location: { file, line },
          severity: "info",
        }),
      ),
    };
  },
};

/** Virtual file carrying MR/PR metadata (branch, title) for governance rules. */
export const MR_METADATA_PATH = "MR-METADATA";

const CHANGELOG_MENTION =
  /changelog|release[-_ ]?change|release[-_ ]?notes|گزارش تغییرات|تاریخچه تغییرات/i;
const CHANGELOG_PATH = /release-change|changelog|release-notes/i;

/**
 * Does the saved project guidance ask for release notes? Learned "- Do not
 * report ..." lines and the recent-feedback digest are skipped: they may carry
 * this rule's own id or a rejected finding's title without being a requirement.
 */
function guidelinesRequireChangelog(instructions: string | undefined): boolean {
  if (!instructions) return false;
  return instructions.split("\n").some((raw) => {
    const line = raw.trim();
    if (/^-\s*Do not report\b/i.test(line)) return false;
    if (/^Recent reviewer feedback\b/i.test(line)) return false;
    if (/^-\s*\[[^\]]*\]\s*"/.test(line)) return false;
    return CHANGELOG_MENTION.test(line);
  });
}

/**
 * Flags source changes that skip the changelog / `release-change` update, but
 * only when the project's saved guidelines say it is required; nothing in the
 * diff itself decides that, so a source-only MR is still caught.
 */
export const requireReleaseChangeRule: Rule = {
  kind: "governance",
  id: "governance.require-release-change",
  description:
    "Source changes without a changelog or release-change update, only when the project guidelines require one.",
  severity: "medium",
  async run(ctx) {
    if (!isFileCtx(ctx)) return { ok: true, value: [] };
    if (!guidelinesRequireChangelog(ctx.projectInstructions)) {
      return { ok: true, value: [] };
    }
    const paths = ctx.files
      .map((f) => f.path)
      .filter((p) => p !== MR_METADATA_PATH);

    // Docs-only and changelog edits are not functional changes.
    const hasSourceChanges = paths.some((p) => {
      const lower = p.toLowerCase();
      if (DOC_FILE.test(lower) || lower.startsWith("docs/")) return false;
      return (
        lower.startsWith("src/") ||
        lower.startsWith("apps/") ||
        lower.startsWith("packages/") ||
        lower.startsWith("lib/") ||
        lower.startsWith("app/") ||
        /\.(ts|tsx|js|jsx|cs|py|java|kt|swift|vue|go|rs|cpp|c|h)$/.test(lower)
      );
    });

    // Any touched path that looks like a release/changelog file counts
    // (CHANGELOG.fa.md, docs/release-notes/1.2.md, release-change/...).
    const hasChangelogInDiff = paths.some((p) => CHANGELOG_PATH.test(p));

    if (!hasSourceChanges || hasChangelogInDiff) return { ok: true, value: [] };
    return {
      ok: true,
      value: [
        {
          ruleKind: "governance",
          ruleId: "governance.require-release-change",
          message: ruleMessage("governance.require-release-change", ctx.language),
          location: { file: MR_METADATA_PATH, line: 1 },
          severity: "medium",
        },
      ],
    };
  },
};

// `alert(...)`, `window.alert|confirm|prompt(...)`, or bare `confirm(`/`prompt(` with
// a string/template first argument; never `Modal.confirm(` or a local `prompt(messages)`.
const BLOCKING_DIALOG =
  /(?<![\w$.])alert\s*\(|\bwindow\.(?:alert|confirm|prompt)\s*\(|(?<![\w$.])(?:confirm|prompt)\s*\(\s*["'`]/;

/**
 * Checks for project lint conventions and common static analysis errors (ESLint / Biome / Type standards).
 */
export const lintComplianceRule: Rule = {
  kind: "eslint",
  id: "no-alert",
  description:
    "Blocking alert/confirm/prompt dialogs in JavaScript and TypeScript.",
  severity: "medium",
  async run(ctx) {
    if (!isFileCtx(ctx)) return { ok: true, value: [] };
    const findings: RuleFinding[] = [];

    for (const file of ctx.files) {
      if (!fileMatchesLangs(file.path, ["js"])) continue;
      const lines = file.text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        // Check for common forbidden patterns: alert(), prompt(), confirm() in client/server code
        if (!isCommentLine(line, file.path) && BLOCKING_DIALOG.test(line)) {
          findings.push({
            ruleKind: "eslint",
            ruleId: "no-alert",
            message: ruleMessage("no-alert", ctx.language),
            location: { file: file.path, line: i + 1 },
            severity: "medium",
          });
        }
      }
    }

    return { ok: true, value: findings };
  },
};

/**
 * Builds the virtual metadata file from the `# Source Branch:` / `# MR Title:`
 * (or `# PR Title:`) header the diff resolver prepends to MR/PR diffs.
 * Returns undefined for plain diffs, so governance rules stay silent there.
 */
export function mrMetadataFile(
  diff: string,
): { path: string; text: string } | undefined {
  const head = diff.split("\n").slice(0, 8);
  const pick = (re: RegExp) =>
    head.map((l) => re.exec(l)?.[1]?.trim()).find((v) => v !== undefined);
  const branch = pick(/^# Source Branch:\s*(.*)$/);
  const title = pick(/^# (?:MR|PR) Title:\s*(.*)$/);
  if (!branch && !title) return undefined;
  return {
    path: MR_METADATA_PATH,
    text: `Source Branch: ${branch ?? ""}\nMessage: ${title ?? ""}`,
  };
}

/** Conventional Commits check applied to the MR/PR title. */
export const commitConventionRule: Rule = {
  kind: "governance",
  id: "governance.commit-convention",
  async run(ctx) {
    if (!isFileCtx(ctx)) return { ok: true, value: [] };
    const conventional =
      /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-zA-Z0-9_\-./]+\))?!?: .+/i;
    const findings: RuleFinding[] = [];
    for (const file of ctx.files) {
      if (file.path !== MR_METADATA_PATH) continue;
      const title = /^Message:(.*)$/m.exec(file.text)?.[1]?.trim();
      if (title && !conventional.test(title)) {
        findings.push({
          ruleKind: "governance",
          ruleId: "governance.commit-convention",
          message: ruleMessage("governance.commit-convention", ctx.language, {
            title: title.slice(0, 60),
          }),
          location: { file: MR_METADATA_PATH, line: 2 },
          severity: "low",
        });
      }
    }
    return { ok: true, value: findings };
  },
};

/** Branch naming check (feat/..., fix/..., chore/..., etc.) on the MR/PR source branch. */
export const branchNamingRule: Rule = {
  kind: "governance",
  id: "governance.branch-naming",
  async run(ctx) {
    if (!isFileCtx(ctx)) return { ok: true, value: [] };
    const valid =
      /^(feature|feat|fix|hotfix|bugfix|chore|docs|refactor|release|test)\/[a-zA-Z0-9._-]+$/i;
    const findings: RuleFinding[] = [];
    for (const file of ctx.files) {
      if (file.path !== MR_METADATA_PATH) continue;
      const branch = /^Source Branch:(.*)$/m.exec(file.text)?.[1]?.trim();
      if (branch && !valid.test(branch)) {
        findings.push({
          ruleKind: "governance",
          ruleId: "governance.branch-naming",
          message: ruleMessage("governance.branch-naming", ctx.language, { branch }),
          location: { file: MR_METADATA_PATH, line: 1 },
          severity: "low",
        });
      }
    }
    return { ok: true, value: findings };
  },
};

/** Opt-in governance rules (AI_REVIEW_GOVERNANCE_RULES=1); they check MR metadata, not code. */
export const GOVERNANCE_RULES: readonly Rule[] = [
  commitConventionRule,
  branchNamingRule,
];

/**
 * Flags SQL built by string concatenation / interpolation (injection risk).
 * Only fires when a SQL keyword pair appears in a string that is combined with
 * a dynamic value, so parameterized queries (`?`, `$1`, `:name`) stay clean.
 */
export const sqlInjectionRule: Rule = {
  kind: "sql_injection",
  id: "security.sql-injection",
  description:
    "SQL built by string concatenation or interpolation instead of parameterized queries.",
  severity: "high",
  async run(ctx) {
    const sql =
      /\b(select\s[^;]*\sfrom|insert\s+into|update\s+\w+\s+set|delete\s+from)\b/i;
    // template literal / Python f-string / C# `$"..."` interpolation, `.format(`, `% (`
    const interpolated =
      /\$\{[^{}]+\}|\bf["'][^"']*\{[^{}]+\}|\$"[^"]*\{[^{}]+\}|["']\s*\.format\s*\(|["']\s*%\s*[(\w]/;
    const concatenated = /(['"`])\s*\+\s*[A-Za-z_$]|[A-Za-z_$)\]]\s*\+\s*(['"`])/;
    return {
      ok: true,
      value: scanLines(
        ctx,
        (line) =>
          sql.test(line) && (interpolated.test(line) || concatenated.test(line))
            ? "dynamic SQL string"
            : undefined,
        (file, line) => ({
          ruleKind: "sql_injection",
          ruleId: "security.sql-injection",
          message: ruleMessage("security.sql-injection", ctx.language),
          location: { file, line },
          severity: "high",
        }),
      ),
    };
  },
};

/** Flags wildcard CORS origins. */
export const wildcardCorsRule: Rule = {
  kind: "cors_misconfig",
  id: "security.wildcard-cors",
  description:
    "CORS configured to allow every origin.",
  severity: "medium",
  async run(ctx) {
    const patterns: readonly RegExp[] = [
      /access-control-allow-origin['"]?\s*[:,]\s*['"]\*['"]/i,
      /\b(origin)\s*:\s*['"]\*['"]/i,
      /\bcors\s*\(\s*\)/,
    ];
    return {
      ok: true,
      value: scanLines(
        ctx,
        (line) =>
          patterns.some((p) => p.test(line)) ? "wildcard CORS" : undefined,
        (file, line) => ({
          ruleKind: "cors_misconfig",
          ruleId: "security.wildcard-cors",
          message: ruleMessage("security.wildcard-cors", ctx.language),
          location: { file, line },
          severity: "medium",
        }),
      ),
    };
  },
};

/**
 * Flags text in the change that tries to steer AI reviewers (prompt injection):
 * classic "ignore previous instructions" phrasing, or an instruction to report
 * nothing / approve that is addressed to an AI, reviewer or model on the same
 * line. Runs on every file type — injections hide in comments and in docs such
 * as AGENTS.md — and does not depend on the model noticing it.
 */
export const promptInjectionRule: Rule = {
  kind: "security",
  id: "security.prompt-injection",
  description:
    "Text in the change that tries to steer AI reviewers (prompt injection).",
  severity: "critical",
  async run(ctx) {
    const classic =
      /\b(?:ignore|disregard|forget|override)\s+(?:all\s+|any\s+)?(?:the\s+)?(?:previous|prior|above|earlier|system)\s+(?:instructions?|prompts?|rules?|messages?)\b/i;
    // Plain "reviewer(s)" is left out: human-facing review notes are fine.
    const addressee =
      /\b(?:ai|llm|gpt|chatgpt|claude|gemini|copilot|assistant|language\s+model|(?:review|reviewer)\s+(?:bots?|agents?))\b/i;
    const directive =
      /\b(?:(?:do\s+not|don'?t|never|must\s+not|should\s+not)\s+(?:report|flag|mention|comment\s+on|raise)|report\s+(?:no|zero|nothing)|(?:no|zero)\s+(?:issues|findings|problems)\s+(?:here|in\s+this)|ignore\s+(?:all\s+|any\s+)?(?:issues|findings|problems|errors|vulnerabilit(?:y|ies))|(?:approve|lgtm)\s+(?:this|the)\s+(?:mr|pr|merge\s+request|pull\s+request|change)|(?:already|has\s+been)\s+(?:approved|reviewed))\b/i;
    // Persian: `\b` does not work on it, so these are plain alternations. Input is
    // normalized first (Arabic ي/ك -> ی/ک, ZWNJ removed) so spelling variants match.
    const faClassic =
      /(?:دستور|قوانین|قبلی)[^\n]{0,40}نادیده\s*بگیر|نادیده\s*بگیر(?:ید)?[^\n]{0,40}(?:دستور|قوانین|قبلی)/;
    const faAddressee = /هوش\s*مصنوعی|مدل\s*زبانی|دستیار|ربات\s*بررسی|بازبین\s*هوشمند/;
    const faDirective =
      /(?:تایید|تأیید)\s*کن|گزارش\s*نکن|مشکلی\s*نیست|هیچ\s*مشکلی|نادیده\s*بگیر/;
    const normalizeFa = (line: string) =>
      line.replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/\u200c/g, "");
    return {
      ok: true,
      value: scanLines(
        ctx,
        (raw) => {
          const line = normalizeFa(raw);
          return classic.test(line) ||
            (addressee.test(line) && directive.test(line)) ||
            faClassic.test(line) ||
            (faAddressee.test(line) && faDirective.test(line))
            ? "instruction aimed at AI reviewers"
            : undefined;
        },
        (file, line) => ({
          ruleKind: "security",
          ruleId: "security.prompt-injection",
          message: ruleMessage("security.prompt-injection", ctx.language),
          location: { file, line },
          severity: "critical",
        }),
      ),
    };
  },
};

/** Declarative single-pattern line rule, optionally limited to some languages. */
function lineRule(spec: {
  readonly id: string;
  readonly kind: string;
  readonly severity: RuleFinding["severity"];
  readonly pattern: RegExp;
  readonly langs?: readonly RuleLang[];
  /** Also match inside full-line comments (default: comment lines are skipped). */
  readonly scanComments?: boolean;
}): Rule {
  return {
    kind: spec.kind,
    id: spec.id,
    description: ruleMessage(spec.id),
    severity: spec.severity,
    async run(ctx) {
      return {
        ok: true,
        value: scanLines(
          ctx,
          (line, path) =>
            (spec.scanComments || !isCommentLine(line, path)) &&
            spec.pattern.test(line)
              ? spec.id
              : undefined,
          (file, line) => ({
            ruleKind: spec.kind,
            ruleId: spec.id,
            message: ruleMessage(spec.id, ctx.language),
            location: { file, line },
            severity: spec.severity,
          }),
          spec.langs,
        ),
      };
    },
  };
}

/**
 * `child_process.exec`/`execSync` with a dynamic command in JS/TS. Bare `exec(`
 * is a callback API in many libraries, so it only counts when the file also
 * imports `child_process`; a qualified `child_process.exec(` always counts. A
 * fixed string literal is not flagged: the risk is user input reaching a shell.
 */
export const jsCommandExecRule: Rule = {
  kind: "security",
  id: "security.js-command-exec",
  description:
    "child_process.exec/execSync with a dynamic command string runs it through a shell.",
  severity: "high",
  async run(ctx) {
    const importsChildProcess = (text: string) =>
      /(?:require\s*\(\s*|from\s+|import\s*\(\s*)['"](?:node:)?child_process['"]/.test(text);
    const qualified = /\b(?:child_process|childProcess|cp)\.(?:exec|execSync)\s*\(/;
    const bare = /(?<![.\w$])(?:exec|execSync)\s*\(/;
    // A dynamic first argument: a template literal with `${}`, a string joined with `+`,
    // or a variable. A plain quoted literal is static.
    const dynamicArg = (rest: string) => {
      const arg = rest.trimStart();
      if (arg.startsWith("`")) return /^`[^`]*\$\{/.test(arg);
      if (/^(['"])/.test(arg)) return /^(['"])(?:\\.|(?!\1).)*\1\s*\+/.test(arg);
      return /^[A-Za-z_$]/.test(arg);
    };
    const findings: RuleFinding[] = [];
    if (!isFileCtx(ctx)) return { ok: true, value: findings };
    for (const file of ctx.files) {
      if (!LANG_PATTERNS.js.test(file.path)) continue;
      const imported = importsChildProcess(file.text);
      const lines = file.text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (isCommentLine(line, file.path)) continue;
        const re = qualified.test(line) ? qualified : imported && bare.test(line) ? bare : undefined;
        if (!re) continue;
        const m = re.exec(line)!;
        if (!dynamicArg(line.slice(m.index + m[0].length))) continue;
        findings.push({
          ruleKind: "security",
          ruleId: "security.js-command-exec",
          message: ruleMessage("security.js-command-exec", ctx.language),
          location: { file: file.path, line: i + 1 },
          severity: "high",
        });
      }
    }
    return { ok: true, value: findings };
  },
};

/** Multi-language rules (Python, Java, C#, PHP, Go, Kotlin, Swift, shell, Docker). */
export const LANGUAGE_RULES: readonly Rule[] = [
  lineRule({
    id: "security.tls-verify-disabled",
    kind: "security",
    severity: "high",
    pattern:
      /verify\s*=\s*False|rejectUnauthorized\s*:\s*false|InsecureSkipVerify\s*:\s*true|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0|ServerCertificateValidationCallback\s*[+]?=|CURLOPT_SSL_VERIFYPEER\s*,\s*(false|0)/,
  }),
  lineRule({
    id: "py.unsafe-deserialization",
    kind: "security",
    severity: "high",
    pattern:
      /\b(?:pickle|cPickle|marshal|dill)\.loads?\s*\(|\byaml\.load\s*\((?![^)]*Loader\s*=\s*(?:yaml\.)?(?:Safe|CSafe)Loader)/,
    langs: ["py"],
  }),
  lineRule({
    id: "py.subprocess-shell",
    kind: "security",
    severity: "high",
    pattern: /\bshell\s*=\s*True\b|\bos\.system\s*\(/,
    langs: ["py"],
  }),
  lineRule({
    id: "py.bare-except",
    kind: "lint",
    severity: "medium",
    pattern: /^\s*except\s*:/,
    langs: ["py"],
  }),
  lineRule({
    id: "py.mutable-default-arg",
    kind: "lint",
    severity: "medium",
    pattern: /\bdef\s+\w+\s*\([^)]*=\s*(?:\[\s*\]|\{\s*\}|dict\(\)|list\(\))/,
    langs: ["py"],
  }),
  lineRule({
    id: "py.no-print",
    kind: "lint",
    severity: "low",
    pattern: /^\s*print\s*\(/,
    langs: ["py"],
  }),
  lineRule({
    id: "java.no-system-out",
    kind: "lint",
    severity: "low",
    pattern: /\bSystem\.(?:out|err)\.print(?:ln|f)?\s*\(|\.printStackTrace\s*\(\s*\)/,
    langs: ["java", "kt"],
  }),
  lineRule({
    id: "java.weak-hash",
    kind: "security",
    severity: "high",
    pattern: /MessageDigest\.getInstance\s*\(\s*"(?:MD5|MD2|SHA-?1)"/i,
    langs: ["java", "kt"],
  }),
  lineRule({
    id: "java.runtime-exec",
    kind: "security",
    severity: "high",
    pattern: /\bRuntime\.getRuntime\(\)\.exec\s*\(/,
    langs: ["java", "kt"],
  }),
  lineRule({
    id: "jvm-cs.empty-catch",
    kind: "lint",
    severity: "medium",
    pattern: /\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/,
    langs: ["java", "cs", "kt", "php", "js"],
  }),
  lineRule({
    id: "cs.no-console",
    kind: "lint",
    severity: "low",
    pattern: /\bConsole\.(?:Write|WriteLine)\s*\(/,
    langs: ["cs"],
  }),
  lineRule({
    id: "cs.weak-hash",
    kind: "security",
    severity: "high",
    pattern: /\b(?:MD5|SHA1)(?:CryptoServiceProvider|Managed)?\.Create\s*\(|new\s+(?:MD5|SHA1)(?:CryptoServiceProvider|Managed)\s*\(/,
    langs: ["cs"],
  }),
  lineRule({
    id: "php.debug-output",
    kind: "lint",
    severity: "low",
    pattern: /\b(?:var_dump|print_r|var_export|phpinfo)\s*\(/,
    langs: ["php"],
  }),
  lineRule({
    id: "php.unsafe-function",
    kind: "security",
    severity: "high",
    pattern: /\b(?:unserialize|shell_exec|passthru|system|popen|proc_open|mysql_[a-z_]+)\s*\(/,
    langs: ["php"],
  }),
  lineRule({
    id: "go.no-print",
    kind: "lint",
    severity: "low",
    pattern: /\bfmt\.Print(?:ln|f)?\s*\(/,
    langs: ["go"],
  }),
  lineRule({
    id: "kt.not-null-assertion",
    kind: "lint",
    severity: "medium",
    pattern: /[\w)\]]!!(?!=)/,
    langs: ["kt"],
  }),
  lineRule({
    id: "swift.force-unwrap",
    kind: "lint",
    severity: "medium",
    pattern: /\btry!|\bas!\s/,
    langs: ["swift"],
  }),
  lineRule({
    id: "sh.curl-pipe-shell",
    kind: "security",
    severity: "high",
    pattern: /\b(?:curl|wget)\b[^|]*\|\s*(?:sudo\s+)?(?:ba|z)?sh\b/,
  }),
  lineRule({
    id: "sh.chmod-777",
    kind: "security",
    severity: "high",
    pattern: /\bchmod\s+(?:-R\s+)?0?777\b/,
  }),
  lineRule({
    id: "docker.latest-tag",
    kind: "lint",
    severity: "medium",
    pattern: /^\s*FROM\s+\S+:latest\b/i,
    langs: ["docker"],
  }),
];

/** The built-in deterministic rule set (static checks that are universal and zero-false-positive). */
export const DEFAULT_RULES: readonly Rule[] = [
  secretDetectionRule,
  noConsoleRule,
  noDebuggerRule,
  noEvalRule,
  sqlInjectionRule,
  wildcardCorsRule,
  promptInjectionRule,
  noExclusiveTestsRule,
  noExplicitAnyRule,
  noTodoRule,
  lintComplianceRule,
  requireReleaseChangeRule,
  jsCommandExecRule,
  ...LANGUAGE_RULES,
];
