/**
 * Critic — the review flow's consolidation stage (before the Judge).
 *
 * Specialist agents run in parallel and independently, so they frequently report
 * the *same* underlying problem (e.g. the security and code reviewers both flag a
 * hardcoded secret on the same line). Publishing both would be noisy and, over
 * incremental reviews, wasteful. The Critic:
 *
 *   1. Groups issues that refer to the same defect (file + line + canonical category, different producers).
 *   2. Merges each group into a single representative issue, keeping the highest
 *      severity and boosting confidence when multiple agents independently agree
 *      (corroboration), while recording every agent that contributed.
 *
 * It is deterministic, free, and fully unit-tested. A future LLM-backed Critic
 * (semantic dedup across differing wording) can implement the same `critique()`
 * contract without changing callers.
 */

import type { AgentId, Issue, Severity } from "@ai-review/core";

const SEVERITY_RANK: Record<Severity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/** An issue after consolidation, annotated with who corroborated it. */
export interface CritiquedIssue extends Issue {
  /** All agents (+ rules) that independently reported this defect. */
  readonly corroboratedBy: readonly AgentId[];
}

/** Canonical category buckets; unknown categories keep their normalized text. */
const CATEGORY_SYNONYMS: Record<string, string> = {
  security: "security",
  vulnerability: "security",
  vulnerabilities: "security",
  injection: "security",
  "security issue": "security",
  "security vulnerability": "security",
  secrets: "security",
  performance: "performance",
  perf: "performance",
  bug: "correctness",
  bugs: "correctness",
  correctness: "correctness",
  logic: "correctness",
  error: "correctness",
  "error handling": "correctness",
  style: "style",
  readability: "style",
  naming: "style",
  formatting: "style",
  maintainability: "maintainability",
  "code quality": "maintainability",
  quality: "maintainability",
};

/** Lower-cases, trims and maps common synonyms onto a small canonical set. */
export function normalizeCategory(category: string): string {
  const norm = category
    .toLowerCase()
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  return CATEGORY_SYNONYMS[norm] ?? norm;
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Groups candidate duplicates by location + canonical category. */
function groupKey(issue: Issue): string {
  return [
    issue.location.file,
    issue.location.line ?? -1,
    normalizeCategory(issue.category),
  ].join("|");
}

/** The same producer repeating itself (identical fingerprint or title). */
function isRepeat(a: Issue, b: Issue): boolean {
  return (
    a.fingerprint === b.fingerprint ||
    normalizeTitle(a.title) === normalizeTitle(b.title)
  );
}

/**
 * Splits a same-location bucket into clusters of one defect each. An issue joins
 * a cluster unless that cluster already holds a *different* issue from the same
 * producer: one agent's two findings on a line are distinct problems, whereas
 * findings from different agents are treated as corroboration.
 */
function cluster(bucket: readonly Issue[]): Issue[][] {
  const clusters: Issue[][] = [];
  for (const issue of bucket) {
    const target = clusters.find((c) =>
      c.every((m) => m.producedBy !== issue.producedBy || isRepeat(m, issue)),
    );
    if (target) target.push(issue);
    else clusters.push([issue]);
  }
  return clusters;
}

/**
 * Corroboration boost: N independent agents agreeing raises confidence toward
 * 1.0 without ever exceeding it. One agent → unchanged; each extra agent closes
 * half the remaining gap. Deterministic and monotonic.
 */
function corroborate(base: number, agreementCount: number): number {
  let c = base;
  for (let i = 1; i < agreementCount; i++) c = c + (1 - c) / 2;
  return Math.min(1, Number(c.toFixed(4)));
}

export function critique(issues: readonly Issue[]): CritiquedIssue[] {
  const groups = new Map<string, Issue[]>();
  for (const issue of issues) {
    const key = groupKey(issue);
    const bucket = groups.get(key);
    if (bucket) bucket.push(issue);
    else groups.set(key, [issue]);
  }

  const merged: CritiquedIssue[] = [];
  for (const bucket of [...groups.values()].flatMap(cluster)) {
    // Representative = highest severity, then highest confidence.
    const rep = [...bucket].sort((a, b) => {
      const s = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
      return s !== 0 ? s : b.confidence - a.confidence;
    })[0]!;

    const contributors = [...new Set(bucket.map((i) => i.producedBy))];
    const confidence =
      contributors.length > 1
        ? corroborate(rep.confidence, contributors.length)
        : rep.confidence;

    merged.push({
      ...rep,
      confidence,
      corroboratedBy: contributors,
      ...(contributors.length > 1
        ? {
            reason: `${rep.reason} (corroborated by ${contributors.length} reviewers)`,
          }
        : {}),
    });
  }

  return merged;
}
