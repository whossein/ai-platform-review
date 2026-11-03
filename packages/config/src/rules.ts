/**
 * Deterministic rules (ADR-0006) — the platform's #1 cost principle in action.
 *
 * These checks run BEFORE any LLM call. They are free (no tokens), precise, and
 * trustworthy. Their findings seed the agents and let the Planner suppress
 * redundant AI work ("secret detection already covers X"). Each rule inspects
 * file texts and returns structured `RuleFinding`s.
 *
 * The set here is intentionally deterministic and regex/heuristic based (no
 * external processes). Real ESLint/tsc integrations implement the same `Rule`
 * contract and register alongside these without changing the engine.
 */

import type { Rule, RuleContext, RuleFinding } from "@ai-review/core";

/** Extended context carrying the file texts to scan (offline, no FS access). */
export interface FileRuleContext extends RuleContext {
  readonly files: readonly { readonly path: string; readonly text: string }[];
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

/** Runs a per-line matcher across all files, producing findings. */
function scanLines(
  ctx: RuleContext,
  match: (line: string) => string | undefined,
  make: (path: string, line: number, why: string) => RuleFinding,
  langs?: readonly RuleLang[],
): RuleFinding[] {
  if (!isFileCtx(ctx)) return [];
  const findings: RuleFinding[] = [];
  for (const file of ctx.files) {
    if (!fileMatchesLangs(file.path, langs)) continue;
    const lines = file.text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const why = match(lines[i]!);
      if (why !== undefined) findings.push(make(file.path, i + 1, why));
    }
  }
  return findings;
}

/** Detects hardcoded secrets / API keys / tokens in added code. */
export const secretDetectionRule: Rule = {
  kind: "secret_detection",
  id: "secret.hardcoded",
  async run(ctx) {
    const patterns: readonly RegExp[] = [
      /sk-[a-zA-Z0-9]{8,}/, // OpenAI-style secret keys
      /(api[_-]?key|secret|token|password)\s*[:=]\s*['"][^'"]{6,}['"]/i,
      /AKIA[0-9A-Z]{16}/, // AWS access key id
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    ];
    return {
      ok: true,
      value: scanLines(
        ctx,
        (line) =>
          patterns.some((p) => p.test(line))
            ? "matches a secret pattern"
            : undefined,
        (file, line) => ({
          ruleKind: "secret_detection",
          ruleId: "secret.hardcoded",
          message:
            "Possible hardcoded secret; move it to an environment variable or secret store.",
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
  async run(ctx) {
    return {
      ok: true,
      value: scanLines(
        ctx,
        (line) =>
          /\bconsole\.(log|debug|info|warn|error)\s*\(/.test(line)
            ? "console call"
            : undefined,
        (file, line) => ({
          ruleKind: "eslint",
          ruleId: "no-console",
          message:
            "Leftover console statement; remove it or use a proper logger.",
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
  async run(ctx) {
    return {
      ok: true,
      value: scanLines(
        ctx,
        (line) =>
          /\bdebugger\s*;?/.test(line) ? "debugger statement" : undefined,
        (file, line) => ({
          ruleKind: "eslint",
          ruleId: "no-debugger",
          message: "Unexpected `debugger` statement found.",
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
  async run(ctx) {
    return {
      ok: true,
      value: scanLines(
        ctx,
        (line) => (/\b(?:eval|exec)\s*\(/.test(line) && !/\.exec\s*\(/.test(line)
            ? "eval function"
            : undefined),
        (file, line) => ({
          ruleKind: "eslint",
          ruleId: "no-eval",
          message:
            "Avoid using `eval()`. It is a major security risk and hurts performance.",
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
  async run(ctx) {
    return {
      ok: true,
      value: scanLines(
        ctx,
        (line) =>
          /\b(describe|it|test)\.(only|skip)\b/.test(line)
            ? "exclusive test"
            : undefined,
        (file, line) => ({
          ruleKind: "eslint",
          ruleId: "no-exclusive-tests",
          message:
            "Exclusive or skipped test found (e.g. `.only` or `.skip`). Ensure this is intentional before merging.",
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
  async run(ctx) {
    return {
      ok: true,
      value: scanLines(
        ctx,
        (line) =>
          /(:\s*any\b|<any>|as\s+any\b|Array<any>)/.test(line)
            ? "any type"
            : undefined,
        (file, line) => ({
          ruleKind: "typescript",
          ruleId: "no-explicit-any",
          message:
            "Use of `any` disables type checking; use a precise type or `unknown`.",
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
          message:
            "Unresolved TODO/FIXME marker; track it in an issue before merging.",
          location: { file, line },
          severity: "info",
        }),
      ),
    };
  },
};

/**
 * Ensures modifications to functional source code include a corresponding update to `release-change` (or CHANGELOG.md)
 * when required by project guidelines or when such files exist in the repository.
 */
export const requireReleaseChangeRule: Rule = {
  kind: "governance",
  id: "governance.require-release-change",
  async run(ctx) {
    if (!isFileCtx(ctx)) return { ok: true, value: [] };
    const findings: RuleFinding[] = [];
    const files = ctx.files;

    // Check if the project actually uses or documents release-change / CHANGELOG / release notes
    const projectRequiresReleaseChange = files.some((f) => {
      const p = f.path.toLowerCase();
      return (
        p.includes("release-change") ||
        p.includes("changelog") ||
        p.includes("release-notes") ||
        (p.startsWith("docs/") &&
          f.text.toLowerCase().includes("release-change")) ||
        (p.endsWith("contributing.md") &&
          f.text.toLowerCase().includes("release-change"))
      );
    });

    if (!projectRequiresReleaseChange) {
      // If the project doesn't have or mention release-change, don't generate false positives
      return { ok: true, value: [] };
    }

    // Check if source code / functional features are modified
    const hasSourceChanges = files.some((f) => {
      const p = f.path.toLowerCase();
      return (
        p.startsWith("src/") ||
        p.startsWith("apps/") ||
        p.startsWith("packages/") ||
        p.startsWith("lib/") ||
        p.startsWith("app/") ||
        /\.(ts|tsx|js|jsx|cs|py|java|kt|swift|vue|go|rs|cpp|c|h)$/.test(p)
      );
    });

    // Any touched path that looks like a release/changelog file counts
    // (CHANGELOG.fa.md, docs/release-notes/1.2.md, release-change/...), not only
    // the exact filenames, otherwise the rule contradicts its own trigger above.
    const hasReleaseChangeInDiff = files.some((f) => {
      const p = f.path.toLowerCase();
      return (
        p.includes("release-change") ||
        p.includes("changelog") ||
        p.includes("release-notes")
      );
    });

    if (hasSourceChanges && !hasReleaseChangeInDiff && files.length > 0) {
      findings.push({
        ruleKind: "governance",
        ruleId: "governance.require-release-change",
        message:
          "فایل release-change (یا CHANGELOG.md) در این تغییرات ویرایش نشده است. طبق راهنمای مستندسازی این پروژه، هرگونه تغییر در سورس‌کد باید در گزارش تغییرات ثبت شود.",
        location: { file: "release-change", line: 1 },
        severity: "high",
      });
    }

    return { ok: true, value: findings };
  },
};

/**
 * Checks for project lint conventions and common static analysis errors (ESLint / Biome / Type standards).
 */
export const lintComplianceRule: Rule = {
  kind: "eslint",
  id: "lint.code-conventions",
  async run(ctx) {
    if (!isFileCtx(ctx)) return { ok: true, value: [] };
    const findings: RuleFinding[] = [];

    for (const file of ctx.files) {
      if (!fileMatchesLangs(file.path, ["js"])) continue;
      const lines = file.text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        // Check for common forbidden patterns: alert(), prompt(), confirm() in client/server code
        if (/\b(window\.)?(alert|confirm|prompt)\s*\(/.test(line)) {
          findings.push({
            ruleKind: "eslint",
            ruleId: "no-alert",
            message:
              "استفاده از توابع مسدودکننده (alert/confirm/prompt) طبق استانداردهای کدنویسی مجاز نیست.",
            location: { file: file.path, line: i + 1 },
            severity: "medium",
          });
        }
      }
    }

    return { ok: true, value: findings };
  },
};

/** Virtual file carrying MR/PR metadata (branch, title) for governance rules. */
export const MR_METADATA_PATH = "MR-METADATA";

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
      const title = /^Message:\s*(.*)$/m.exec(file.text)?.[1]?.trim();
      if (title && !conventional.test(title)) {
        findings.push({
          ruleKind: "governance",
          ruleId: "governance.commit-convention",
          message: `MR/PR title "${title.slice(0, 60)}" does not follow Conventional Commits (e.g. "feat: ..." or "fix(scope): ...").`,
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
      const branch = /^Source Branch:\s*(.*)$/m.exec(file.text)?.[1]?.trim();
      if (branch && !valid.test(branch)) {
        findings.push({
          ruleKind: "governance",
          ruleId: "governance.branch-naming",
          message: `Branch "${branch}" does not match the naming convention (e.g. feat/name or fix/issue-123).`,
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
  async run(ctx) {
    const sql =
      /\b(select\s[^;]*\sfrom|insert\s+into|update\s+\w+\s+set|delete\s+from)\b/i;
    // template literal / Python f-string / C# `$"..."` interpolation, `.format(`, `% (`
    const interpolated =
      /\$\{[^}]+\}|\bf["'][^"']*\{[^}]+\}|\$"[^"]*\{[^}]+\}|["']\s*\.format\s*\(|["']\s*%\s*[(\w]/;
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
          message:
            "SQL query is built with string concatenation or interpolation; use parameterized queries / prepared statements.",
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
          message:
            "CORS allows every origin; restrict it to an explicit allow-list of trusted origins.",
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
  async run(ctx) {
    const classic =
      /\b(?:ignore|disregard|forget|override)\s+(?:all\s+|any\s+)?(?:the\s+)?(?:previous|prior|above|earlier|system)\s+(?:instructions?|prompts?|rules?|messages?)\b/i;
    // Plain "reviewer(s)" is left out: human-facing review notes are fine.
    const addressee =
      /\b(?:ai|llm|gpt|chatgpt|claude|gemini|copilot|assistant|language\s+model|(?:review|reviewer)\s+(?:bots?|agents?))\b/i;
    const directive =
      /\b(?:(?:do\s+not|don'?t|never|must\s+not|should\s+not)\s+(?:report|flag|mention|comment\s+on|raise)|report\s+(?:no|zero|nothing)|(?:no|zero)\s+(?:issues|findings|problems)\s+(?:here|in\s+this)|ignore\s+(?:all\s+|any\s+)?(?:issues|findings|problems|errors|vulnerabilit(?:y|ies))|(?:approve|lgtm)\s+(?:this|the)\s+(?:mr|pr|merge\s+request|pull\s+request|change)|(?:already|has\s+been)\s+(?:approved|reviewed))\b/i;
    return {
      ok: true,
      value: scanLines(
        ctx,
        (line) =>
          classic.test(line) || (addressee.test(line) && directive.test(line))
            ? "instruction aimed at AI reviewers"
            : undefined,
        (file, line) => ({
          ruleKind: "security",
          ruleId: "security.prompt-injection",
          message:
            "This line looks like an instruction aimed at AI reviewers (prompt injection). Remove it; review rules belong in the project's saved guidelines, not in the change.",
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
  readonly message: string;
  readonly langs?: readonly RuleLang[];
}): Rule {
  return {
    kind: spec.kind,
    id: spec.id,
    async run(ctx) {
      return {
        ok: true,
        value: scanLines(
          ctx,
          (line) => (spec.pattern.test(line) ? spec.id : undefined),
          (file, line) => ({
            ruleKind: spec.kind,
            ruleId: spec.id,
            message: spec.message,
            location: { file, line },
            severity: spec.severity,
          }),
          spec.langs,
        ),
      };
    },
  };
}

/** Multi-language rules (Python, Java, C#, PHP, Go, Kotlin, Swift, shell, Docker). */
export const LANGUAGE_RULES: readonly Rule[] = [
  lineRule({
    id: "security.tls-verify-disabled",
    kind: "security",
    severity: "high",
    pattern:
      /verify\s*=\s*False|rejectUnauthorized\s*:\s*false|InsecureSkipVerify\s*:\s*true|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0|ServerCertificateValidationCallback\s*[+]?=|CURLOPT_SSL_VERIFYPEER\s*,\s*(false|0)/,
    message:
      "TLS certificate verification is disabled; this allows man-in-the-middle attacks.",
  }),
  lineRule({
    id: "py.unsafe-deserialization",
    kind: "security",
    severity: "high",
    pattern:
      /\b(?:pickle|cPickle|marshal|dill)\.loads?\s*\(|\byaml\.load\s*\((?![^)]*Loader\s*=\s*(?:yaml\.)?(?:Safe|CSafe)Loader)/,
    message:
      "Unsafe deserialization can execute arbitrary code; use json or yaml.safe_load for untrusted data.",
    langs: ["py"],
  }),
  lineRule({
    id: "py.subprocess-shell",
    kind: "security",
    severity: "high",
    pattern: /\bshell\s*=\s*True\b|\bos\.system\s*\(/,
    message:
      "Running commands through a shell allows command injection; pass an argument list without shell=True.",
    langs: ["py"],
  }),
  lineRule({
    id: "py.bare-except",
    kind: "lint",
    severity: "medium",
    pattern: /^\s*except\s*:/,
    message:
      "Bare `except:` also swallows KeyboardInterrupt/SystemExit; catch a specific exception.",
    langs: ["py"],
  }),
  lineRule({
    id: "py.mutable-default-arg",
    kind: "lint",
    severity: "medium",
    pattern: /\bdef\s+\w+\s*\([^)]*=\s*(?:\[\s*\]|\{\s*\}|dict\(\)|list\(\))/,
    message:
      "Mutable default argument is shared between calls; default to None and create it inside the function.",
    langs: ["py"],
  }),
  lineRule({
    id: "py.no-print",
    kind: "lint",
    severity: "low",
    pattern: /^\s*print\s*\(/,
    message: "Leftover print statement; use the logging module.",
    langs: ["py"],
  }),
  lineRule({
    id: "java.no-system-out",
    kind: "lint",
    severity: "low",
    pattern: /\bSystem\.(?:out|err)\.print(?:ln|f)?\s*\(|\.printStackTrace\s*\(\s*\)/,
    message: "Leftover System.out/printStackTrace; use a logger.",
    langs: ["java", "kt"],
  }),
  lineRule({
    id: "java.weak-hash",
    kind: "security",
    severity: "high",
    pattern: /MessageDigest\.getInstance\s*\(\s*"(?:MD5|MD2|SHA-?1)"/i,
    message: "MD5/SHA-1 are broken for security use; use SHA-256 or stronger (bcrypt/argon2 for passwords).",
    langs: ["java", "kt"],
  }),
  lineRule({
    id: "java.runtime-exec",
    kind: "security",
    severity: "high",
    pattern: /\bRuntime\.getRuntime\(\)\.exec\s*\(/,
    message: "Runtime.exec with dynamic input risks command injection; validate input or use ProcessBuilder with fixed arguments.",
    langs: ["java", "kt"],
  }),
  lineRule({
    id: "jvm-cs.empty-catch",
    kind: "lint",
    severity: "medium",
    pattern: /\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/,
    message: "Empty catch block silently swallows errors; handle or log the exception.",
    langs: ["java", "cs", "kt", "php", "js"],
  }),
  lineRule({
    id: "cs.no-console",
    kind: "lint",
    severity: "low",
    pattern: /\bConsole\.(?:Write|WriteLine)\s*\(/,
    message: "Leftover Console output; use ILogger.",
    langs: ["cs"],
  }),
  lineRule({
    id: "cs.weak-hash",
    kind: "security",
    severity: "high",
    pattern: /\b(?:MD5|SHA1)(?:CryptoServiceProvider|Managed)?\.Create\s*\(|new\s+(?:MD5|SHA1)(?:CryptoServiceProvider|Managed)\s*\(/,
    message: "MD5/SHA-1 are broken for security use; use SHA-256 or stronger.",
    langs: ["cs"],
  }),
  lineRule({
    id: "php.debug-output",
    kind: "lint",
    severity: "low",
    pattern: /\b(?:var_dump|print_r|var_export|phpinfo)\s*\(/,
    message: "Leftover debug output; remove it before merging.",
    langs: ["php"],
  }),
  lineRule({
    id: "php.unsafe-function",
    kind: "security",
    severity: "high",
    pattern: /\b(?:unserialize|shell_exec|passthru|system|popen|proc_open|mysql_[a-z_]+)\s*\(/,
    message: "Dangerous or removed PHP function (unserialize/shell exec/mysql_*); use safe alternatives (json, escapeshellarg, PDO).",
    langs: ["php"],
  }),
  lineRule({
    id: "go.no-print",
    kind: "lint",
    severity: "low",
    pattern: /\bfmt\.Print(?:ln|f)?\s*\(/,
    message: "Leftover fmt.Print; use a structured logger.",
    langs: ["go"],
  }),
  lineRule({
    id: "kt.not-null-assertion",
    kind: "lint",
    severity: "medium",
    pattern: /[\w)\]]!!(?!=)/,
    message: "`!!` throws NullPointerException; handle null with ?: or safe calls.",
    langs: ["kt"],
  }),
  lineRule({
    id: "swift.force-unwrap",
    kind: "lint",
    severity: "medium",
    pattern: /\btry!|\bas!\s/,
    message: "Forced `try!`/`as!` crashes at runtime on failure; use do/catch or conditional casts.",
    langs: ["swift"],
  }),
  lineRule({
    id: "sh.curl-pipe-shell",
    kind: "security",
    severity: "high",
    pattern: /\b(?:curl|wget)\b[^|]*\|\s*(?:sudo\s+)?(?:ba|z)?sh\b/,
    message: "Piping a download into a shell runs unverified code; download, verify a checksum, then execute.",
  }),
  lineRule({
    id: "sh.chmod-777",
    kind: "security",
    severity: "high",
    pattern: /\bchmod\s+(?:-R\s+)?0?777\b/,
    message: "World-writable permissions (777) are unsafe; grant the minimum required mode.",
  }),
  lineRule({
    id: "docker.latest-tag",
    kind: "lint",
    severity: "medium",
    pattern: /^\s*FROM\s+\S+:latest\b/i,
    message: "Base image uses the `latest` tag; pin a specific version or digest for reproducible builds.",
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
  ...LANGUAGE_RULES,
];
