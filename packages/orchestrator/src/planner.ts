/**
 * Planner — Smart Routing (the review flow's first stage).
 *
 * The single biggest token lever after the deterministic Rule Engine: only run
 * the specialists that the change can actually benefit from. The Planner inspects
 * the changed files (paths + added lines) and selects a subset of specialists,
 * so a pure-CSS change never pays for a security LLM call, and a change with no
 * React files never pays for the React reviewer.
 *
 * It is deterministic and free (no LLM), fully unit-tested, and returns a plan
 * the orchestrator executes. A future LLM-backed Planner can implement the same
 * `plan()` contract without changing callers (ADR-0003/0007).
 */

import type { AgentDefinition, AgentId } from "@ai-review/core";

export interface PlanInput {
  /** The unified diff under review. */
  readonly diff: string;
  /** All available agents (already registered). */
  readonly agents: readonly AgentDefinition[];
  /**
   * Whether the project has saved guidelines. The Contributing & Governance
   * reviewer only applies the project's own rules, so it is skipped when this
   * is `false`. Omitted means unknown: it still runs.
   */
  readonly hasProjectInstructions?: boolean;
}

export interface ReviewPlan {
  /** Agents selected to run, highest priority first. */
  readonly selected: readonly AgentDefinition[];
  /** Agents intentionally skipped, with a human-readable reason. */
  readonly skipped: readonly {
    readonly agent: AgentDefinition;
    readonly reason: string;
  }[];
  /** The distinct file extensions detected in the change. */
  readonly extensions: readonly string[];
}

/** Extracts changed file paths from `diff --git a/… b/…` / `+++ b/…` headers. */
export function changedFiles(diff: string): string[] {
  const files = new Set<string>();
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git a/")) {
      const b = line.lastIndexOf(" b/");
      if (b > 13 && b + 3 < line.length) files.add(line.slice(b + 3));
    }
    const plus = /^\+\+\+ b\/(.+)$/.exec(line);
    if (plus?.[1] && plus[1] !== "/dev/null") files.add(plus[1]);
  }
  return [...files];
}

function extOf(path: string): string {
  const i = path.lastIndexOf(".");
  return i === -1 ? "" : path.slice(i).toLowerCase();
}

/** Added (`+`) lines only — what the change actually introduces. */
function addedText(diff: string): string {
  return diff
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .join("\n");
}

/**
 * Extensions of files that carry no executable logic worth a security /
 * performance / code review: docs, plain text, media, lockfiles and pure
 * styling. Anything else (including extension-less files such as `Dockerfile`)
 * is treated as code, so new languages are covered by default.
 */
const NON_CODE_EXTS: ReadonlySet<string> = new Set([
  ".md", ".mdx", ".txt", ".rst", ".adoc",
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp", ".bmp",
  ".pdf", ".lock",
  ".css", ".scss", ".sass", ".less",
]);

/**
 * Languages other than Python; when one of these is in the change, a bare
 * `import x` / `def f(` in the added lines is not evidence of Python.
 */
const NON_PYTHON_LANG_EXTS: ReadonlySet<string> = new Set([
  ".kt", ".java", ".xml", ".swift", ".m", ".h", ".ts", ".tsx", ".js", ".jsx",
  ".mjs", ".cjs", ".go", ".rs", ".php", ".rb", ".c", ".cc", ".cpp", ".cxx",
  ".hpp", ".dart", ".scala", ".cs", ".sh", ".bash", ".sql", ".lua", ".ex",
  ".exs", ".clj", ".groovy", ".vue",
]);

const JS_TS_EXTS: ReadonlySet<string> = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
]);

/** Extension of the final path segment (so `a.b/Dockerfile` has none). */
function baseExt(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const i = base.lastIndexOf(".");
  return i <= 0 ? "" : base.slice(i).toLowerCase();
}

/**
 * A change has code unless every changed file is a known non-code type. With no
 * parsed files (empty diff / parse failure) we stay conservative and say yes.
 */
function hasCode(files: readonly string[]): boolean {
  if (files.length === 0) return true;
  return files.some((f) => !NON_CODE_EXTS.has(baseExt(f)));
}

/**
 * Decides whether a specialist is relevant to this change. Kept intentionally
 * simple and conservative: when unsure, include the specialist (a missed review
 * is worse than a few extra tokens). Heuristics are per-focus.
 */
function isRelevant(
  agentId: AgentId,
  ctx: {
    readonly files: readonly string[];
    readonly added: string;
    readonly exts: Set<string>;
    readonly hasProjectInstructions?: boolean;
  },
): boolean {
  // If there are no files (e.g., empty diff or parsing failed), we might want to default to running general reviewers just in case.
  const hasCodeFiles = hasCode(ctx.files);

  switch (agentId) {
    case "agent.react-reviewer": {
      if ([".tsx", ".jsx"].some((e) => ctx.exts.has(e))) return true;
      // Added-line evidence only counts inside JS/TS files: `List<String>` in
      // Java or `#include <Foo.h>` in C are generics/includes, not JSX.
      if (![...JS_TS_EXTS].some((e) => ctx.exts.has(e))) return false;
      const hasReactImport = /\bfrom\s+["']react(?:-dom)?(?:\/[^"']*)?["']|\brequire\(\s*["']react["']/.test(
        ctx.added,
      );
      return (
        hasReactImport ||
        /\buse(?:State|Effect|Memo|Callback|Ref|Context|Reducer|LayoutEffect)\s*\(/.test(
          ctx.added,
        ) ||
        // Real JSX: a self-closing element or one with attributes. A bare
        // `<Foo>` is as likely to be a generic (`Promise<Foo>`).
        /<[A-Z][A-Za-z0-9.]*(?:\s+[A-Za-z_:-]+\s*=|\s*\/>)/.test(ctx.added)
      );
    }
    case "agent.dotnet-reviewer":
      return (
        [".cs", ".csproj", ".sln", ".cshtml"].some((e) => ctx.exts.has(e)) ||
        /\busing\s+System\b/.test(ctx.added)
      );
    case "agent.python-reviewer":
      return (
        [".py", ".ipynb"].some((e) => ctx.exts.has(e)) ||
        (![...ctx.exts].some((e) => NON_PYTHON_LANG_EXTS.has(e)) &&
          /\bimport\s+[a-zA-Z_]\w*\b|\bdef\s+[a-zA-Z_]\w*\s*\(/.test(ctx.added))
      );
    case "agent.android-reviewer":
      // Plain .java/.xml are everywhere (servers, Maven); require Android evidence.
      return (
        [".kt", ".kts"].some((e) => ctx.exts.has(e)) ||
        ctx.files.some(
          (f) =>
            /(^|\/)AndroidManifest\.xml$/.test(f) || /(^|\/)res\/.+\.xml$/.test(f),
        ) ||
        /\bimport\s+androidx?\./.test(ctx.added)
      );
    case "agent.ios-reviewer":
      return (
        [".swift", ".m", ".mm"].some((e) => ctx.exts.has(e)) ||
        // A bare .h is usually plain C/C++.
        (ctx.exts.has(".h") &&
          /@interface\b|#import\s*<(?:UIKit|Foundation)/.test(ctx.added)) ||
        /\bimport\s+(?:UIKit|SwiftUI|Foundation)\b/.test(ctx.added)
      );
    case "agent.nextjs-reviewer":
      // Only real Next.js evidence: a plain React app also has `app/` or `pages/`
      // folders, so folder names alone must not select this specialist.
      return (
        [".tsx", ".jsx", ".ts", ".js", ".mjs"].some((e) => ctx.exts.has(e)) &&
        (/from\s+["']next(\/|["'])|require\(\s*["']next(\/|["'])|^\+\s*["']use (client|server)["']|\bgetServerSideProps\b|\bgetStaticProps\b|\bgenerateMetadata\b/m.test(
          ctx.added,
        ) ||
          ctx.files.some((f) =>
            /(^|\/)next\.config\.(js|mjs|ts)$|(^|\/)(app|src\/app)\/(.+\/)?(page|layout|route|loading|error)\.(tsx|jsx|ts|js)$|(^|\/)(pages|src\/pages)\/_(app|document)\.(tsx|jsx|js)$/.test(
              f,
            ),
          ))
      );
    case "agent.angular-reviewer":
      return (
        [".ts", ".html"].some((e) => ctx.exts.has(e)) &&
        /\b@Component\b|\b@Injectable\b|\b@NgModule\b/.test(ctx.added)
      );
    case "agent.vue-reviewer":
      return (
        ctx.exts.has(".vue") ||
        // Bare `ref(` / `reactive(` are common names in non-Vue code.
        /\bfrom\s+["']vue["']|\bdefineComponent\b/.test(ctx.added)
      );
    case "agent.typescript-reviewer":
      return [".ts", ".tsx"].some((e) => ctx.exts.has(e));
    case "agent.react-native-reviewer":
      return (
        [".tsx", ".jsx", ".js", ".ts"].some((e) => ctx.exts.has(e)) &&
        /\breact-native\b/.test(ctx.added)
      );

    // General reviewers
    case "agent.security-reviewer":
    case "agent.performance-reviewer":
    case "agent.code-reviewer":
      return hasCodeFiles;

    case "agent.contributing-reviewer":
      // It enforces only the project's own guidelines (its prompt forbids inventing
      // rules), and its skill needs a branch or commit message the review never
      // supplies. With no guidelines there is nothing to check, so skip the call.
      return ctx.hasProjectInstructions !== false;

    default:
      // If we don't know the focus (e.g. custom user skills), default to running it
      // or we could check if they have targets configured, but the planner currently just sees 'focus' string.
      // We will default to true so we don't accidentally skip a custom skill.
      return true;
  }
}

export function plan(input: PlanInput): ReviewPlan {
  const files = changedFiles(input.diff);
  const exts = new Set(files.map(extOf).filter(Boolean));
  const added = addedText(input.diff);

  const selected: AgentDefinition[] = [];
  const skipped: { agent: AgentDefinition; reason: string }[] = [];

  for (const agent of input.agents) {
    if (
      !isRelevant(agent.id, {
        files,
        added,
        exts,
        ...(input.hasProjectInstructions !== undefined
          ? { hasProjectInstructions: input.hasProjectInstructions }
          : {}),
      })
    ) {
      skipped.push({
        agent,
        reason:
          agent.id === "agent.contributing-reviewer"
            ? "the project has no guidelines to apply"
            : `no ${agent.id}-relevant files in the change`,
      });
      continue;
    }
    selected.push(agent);
  }

  // Highest-priority specialists first (security > react > performance > code).
  selected.sort((a, b) => b.priority - a.priority);

  return {
    selected,
    skipped,
    extensions: [...exts],
  };
}
