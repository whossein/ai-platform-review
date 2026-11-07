import type { Issue, IssueCategory } from "@ai-review/core";
import type { CandidateFinding } from "./types.js";

/**
 * Producer category (free text from the model, or an agent focus) -> the matcher taxonomy.
 * Keys are normalized: lower-case, `_`/`-` as spaces.
 *
 * Decisions, given how `checkCategoryCompatibility` treats pairs:
 * - security / performance keep their identity.
 * - `code` is the broadest candidate (matches expected code, architecture, maintainability),
 *   so framework/language names, style and code-quality labels map to it. A candidate
 *   `maintainability` can never match an expected `code`, so it is folded into `code` too.
 * - `correctness` is kept for genuine defects (bug, logic, error handling). The matcher
 *   treats `correctness` and `code` as cross-compatible, so either label can match an
 *   expected `code` or `correctness` finding (dataset v2-02 and v2-04).
 * - Unknown categories pass through unchanged.
 */
const CATEGORY_MAP: Record<string, IssueCategory> = {
  security: "security",
  vulnerability: "security",
  vulnerabilities: "security",
  injection: "security",
  secrets: "security",
  "security issue": "security",
  "security vulnerability": "security",
  performance: "performance",
  perf: "performance",
  bug: "correctness",
  bugs: "correctness",
  logic: "correctness",
  error: "correctness",
  "error handling": "correctness",
  correctness: "correctness",
  style: "code",
  readability: "code",
  naming: "code",
  formatting: "code",
  "code quality": "code",
  quality: "code",
  maintainability: "code",
  react: "code",
  "react native": "code",
  nextjs: "code",
  angular: "code",
  vuejs: "code",
  typescript: "code",
  javascript: "code",
  python: "code",
  java: "code",
  android: "code",
  ios: "code",
  dotnet: "code",
  csharp: "code",
  "dotnet, csharp": "code",
  docs: "documentation",
  "governance, contributing, docs": "documentation",
};

/** Maps a producer category onto the matcher taxonomy; unknown values pass through. */
export function mapCategory(category: string): IssueCategory {
  const norm = category
    .toLowerCase()
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  return CATEGORY_MAP[norm] ?? (category as IssueCategory);
}

/** Lifts a pipeline `Issue` (rule-engine or LLM) into the evaluator's shape. */
export function issueToCandidate(
  issue: Pick<
    Issue,
    "title" | "description" | "reason" | "location" | "category" | "severity"
  > & { id: string; suggestion?: string | { readonly description: string } | undefined; producedBy?: string | undefined },
  index: number,
  accepted = true,
): CandidateFinding {
  const { file, line, endLine } = issue.location;
  const suggestion =
    typeof issue.suggestion === "string"
      ? issue.suggestion
      : issue.suggestion?.description;
  return {
    // Fingerprints can collide across rules; the index keeps ids unique per case.
    id: `${issue.id}#${index}`,
    title: issue.title,
    description: issue.description,
    reason: issue.reason,
    ...(suggestion ? { suggestion } : {}),
    location: {
      file,
      ...(line !== undefined ? { line } : {}),
      ...(endLine !== undefined ? { endLine } : {}),
    },
    category: mapCategory(issue.category),
    severity: issue.severity,
    accepted,
    ...(issue.producedBy ? { producedBy: String(issue.producedBy) } : {}),
  };
}
