/**
 * Critic — the review flow's consolidation stage (before the Judge).
 *
 * Specialist agents run in parallel and independently, so they frequently report
 * the *same* underlying problem (e.g. the security and code reviewers both flag a
 * hardcoded secret on the same line). Publishing both would be noisy and, over
 * incremental reviews, wasteful. The Critic:
 *
 *   1. Groups issues that refer to the same defect: same file + line AND
 *      evidence of the same defect. Category is not required to match (models
 *      file one defect under different free-text categories); across different
 *      canonical categories only an identical fingerprint/title or enough shared
 *      wording counts, never the rule-engine shortcut. Cross-producer evidence needs
 *      only ONE member of the cluster from another producer that matches
 *      (identical fingerprint or title, or enough shared wording); same-producer
 *      members must ALL be repeats of the issue. "Same defect" is not
 *      transitive, so requiring a match with every member left one defect
 *      reported twice; the trade-off is that matches can chain (A~B, B~C joins
 *      A and C). Two agents flagging different problems on one line stay as two
 *      findings: merging them would lose one and wrongly inflate confidence.
 *      Deterministic rule findings carry a rule id as title, so for security they
 *      match an agent finding at the same location without a wording comparison.
 *   2. Merges each group into a single representative issue, keeping the highest
 *      severity and boosting confidence when multiple agents independently agree
 *      (corroboration), while recording every agent that contributed.
 *
 * It is deterministic, free, and fully unit-tested. A future LLM-backed Critic
 * (semantic dedup across differing wording) can implement the same `critique()`
 * contract without changing callers.
 */

import type { AgentId, Issue, Severity } from "@ai-review/core";
import { RULE_ENGINE_AGENT } from "@ai-review/config";

/** Minimum word-token Jaccard overlap for two producers to be the same defect. */
export const SAME_DEFECT_MIN_OVERLAP = 0.5;

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

/**
 * Groups candidate duplicates by location only. Category is free text written by
 * each model, so one defect is often filed under different categories (a leaked
 * reader as `performance`, `resource-management` and `security`); the category
 * is compared inside `isSameDefect`, not used to keep findings apart.
 */
function groupKey(issue: Issue): string {
  return [issue.location.file, issue.location.line ?? -1].join("|");
}

/** The same producer repeating itself (identical fingerprint or title). */
function isRepeat(a: Issue, b: Issue): boolean {
  return (
    a.fingerprint === b.fingerprint ||
    normalizeTitle(a.title) === normalizeTitle(b.title)
  );
}

/** Unicode-aware word tokens of title + description, short tokens dropped. */
function tokens(issue: Issue): Set<string> {
  const words = `${issue.title} ${issue.description}`
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu);
  return new Set((words ?? []).filter((w) => w.length >= 3));
}

/** Word tokens (3+ letters) of the title alone, which names the defect. */
function titleTokens(issue: Issue): Set<string> {
  const words = issue.title.toLowerCase().match(/[\p{L}\p{N}]+/gu);
  return new Set((words ?? []).filter((w) => w.length >= 3));
}

/**
 * Two short titles that largely share their wording ("BufferedReader is no
 * longer closed" / "BufferedReader is never closed"). Titles are compared on
 * their own because long descriptions dilute the overlap. At least two shared
 * words and half the union are required, so a single shared identifier is not
 * enough to merge different problems.
 */
function similarTitles(a: Issue, b: Issue): boolean {
  const ta = titleTokens(a);
  const tb = titleTokens(b);
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared >= 2 && jaccard(ta, tb) >= SAME_DEFECT_MIN_OVERLAP;
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

/**
 * Whether two findings from different producers at one location describe the
 * same defect. When unsure, answer no: two findings beat losing one.
 */
function isSameDefect(a: Issue, b: Issue): boolean {
  if (isRepeat(a, b)) return true;
  // Rule titles are rule ids, so wording says nothing: at one location a rule
  // matches an agent finding by shortcut, but only when BOTH are security. A
  // security rule must never absorb a correctness finding on the same line.
  if (
    (a.producedBy === RULE_ENGINE_AGENT) !== (b.producedBy === RULE_ENGINE_AGENT) &&
    normalizeCategory(a.category) === "security" &&
    normalizeCategory(b.category) === "security"
  ) {
    return true;
  }
  // Same or different canonical category, the remaining evidence is wording.
  return (
    jaccard(tokens(a), tokens(b)) >= SAME_DEFECT_MIN_OVERLAP ||
    similarTitles(a, b)
  );
}

/**
 * Whether `issue` may join `c`. Same-producer constraint is strict: every member
 * from the issue's own producer must be a repeat of it (one agent's two findings
 * on a line are distinct problems). Cross-producer evidence is "at least one":
 * some member from another producer is the same defect, or a same-producer
 * member is a repeat. No evidence at all means no join.
 */
function canJoin(c: readonly Issue[], issue: Issue): boolean {
  let evidence = false;
  for (const m of c) {
    if (m.producedBy === issue.producedBy) {
      if (!isRepeat(m, issue)) return false;
      evidence = true;
    } else if (isSameDefect(m, issue)) {
      evidence = true;
    }
  }
  return evidence;
}

/**
 * Splits a same-location bucket into clusters of one defect each, per `canJoin`.
 * An issue may bridge clusters that already exist (e.g. a rule finding arriving
 * after agents that matched each other but not a third agent): other joinable
 * clusters are merged in too, but only if every one of their members could join
 * the merged cluster, so same-producer distinct findings are never fused.
 */
function cluster(bucket: readonly Issue[]): Issue[][] {
  let clusters: Issue[][] = [];
  for (const issue of bucket) {
    const joinable = clusters.filter((c) => canJoin(c, issue));
    const target = joinable[0];
    if (!target) {
      clusters.push([issue]);
      continue;
    }
    target.push(issue);
    for (const other of joinable.slice(1)) {
      if (other.every((m) => canJoin(target, m))) {
        target.push(...other);
        clusters = clusters.filter((c) => c !== other);
      }
    }
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
