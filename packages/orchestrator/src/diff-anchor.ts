/**
 * Diff line-number annotation and issue anchoring.
 *
 * LLMs are unreliable at counting lines in a raw unified diff, so the diff is
 * sent with explicit new-file line numbers (`annotateDiffLineNumbers`) and the
 * issues that come back are snapped onto lines the diff actually touches
 * (`anchorIssues`), so inline MR comments land where they belong.
 */

import type { Issue } from "@ai-review/core";

/** Width of the line-number gutter prepended to every in-hunk line. */
const GUTTER_WIDTH = 6;
const HUNK_RE = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Per-file facts needed to anchor an issue. */
interface FileLines {
  /** New-file line numbers of added lines, ascending. */
  readonly added: number[];
  /** Inclusive new-file ranges covered by hunks. */
  readonly ranges: Array<readonly [number, number]>;
}

/** Strips `a/`, `b/` and `./` prefixes so diff and issue paths compare equal. */
function normalizePath(path: string): string {
  return path
    .trim()
    .replace(/^(?:[ab]\/|\.\/)+/, "")
    .replace(/^\/+/, "");
}

/**
 * Prefixes every added/context line of each hunk with its new-file line number
 * (right-aligned in a 6-char gutter) and removed lines with blank padding.
 * Headers (including `# Target Branch:` lines) are left unchanged.
 */
export function annotateDiffLineNumbers(diff: string): string {
  const out: string[] = [];
  let oldLeft = 0;
  let newLeft = 0;
  let newNo = 0;
  const blank = " ".repeat(GUTTER_WIDTH);

  for (const raw of diff.split("\n")) {
    if (oldLeft > 0 || newLeft > 0) {
      const marker = raw[0];
      if (marker === "\\") {
        out.push(raw);
        continue;
      }
      if (marker === "-") {
        oldLeft--;
        out.push(`${blank}${raw}`);
        continue;
      }
      if (marker === "+") {
        newLeft--;
        out.push(`${String(newNo).padStart(GUTTER_WIDTH)}${raw}`);
        newNo++;
        continue;
      }
      if (marker === " " || raw === "") {
        oldLeft--;
        newLeft--;
        const line = raw === "" ? " " : raw;
        out.push(`${String(newNo).padStart(GUTTER_WIDTH)}${line}`);
        newNo++;
        continue;
      }
      // Malformed hunk (counts overstated): fall through and treat as header.
      oldLeft = 0;
      newLeft = 0;
    }
    const hunk = HUNK_RE.exec(raw);
    if (hunk) {
      oldLeft = hunk[1] === undefined ? 1 : Number(hunk[1]);
      newLeft = hunk[3] === undefined ? 1 : Number(hunk[3]);
      newNo = Number(hunk[2]);
    }
    out.push(raw);
  }
  return out.join("\n");
}

/** Collects added lines and hunk ranges per (normalized) file path. */
function collectFileLines(diff: string): Map<string, FileLines> {
  const files = new Map<string, FileLines>();
  let current: FileLines | undefined;
  let currentHasHunks = false;
  let oldPath = "";
  let oldLeft = 0;
  let newLeft = 0;
  let newNo = 0;

  const open = (path: string): FileLines => {
    const key = normalizePath(path);
    let entry = files.get(key);
    if (!entry) {
      entry = { added: [], ranges: [] };
      files.set(key, entry);
    }
    return entry;
  };

  for (const raw of diff.split("\n")) {
    if (oldLeft > 0 || newLeft > 0) {
      const marker = raw[0];
      if (marker === "\\") continue;
      if (marker === "-") {
        oldLeft--;
        continue;
      }
      if (marker === "+") {
        newLeft--;
        current?.added.push(newNo++);
        continue;
      }
      if (marker === " " || raw === "") {
        oldLeft--;
        newLeft--;
        newNo++;
        continue;
      }
      oldLeft = 0;
      newLeft = 0;
    }
    if (raw.startsWith("diff --git ")) {
      const m = /^diff --git \S+ (\S+)/.exec(raw);
      current = open(m?.[1] ?? "unknown");
      currentHasHunks = false;
      oldPath = "";
      continue;
    }
    if (raw.startsWith("--- ")) {
      oldPath = raw.slice(4);
      continue;
    }
    if (raw.startsWith("+++ ")) {
      const path = raw.slice(4);
      // A bare diff (no `diff --git`) starts a new file at each `+++`.
      if (!current || currentHasHunks) {
        current = undefined;
        currentHasHunks = false;
      }
      if (path.trim() === "/dev/null") {
        if (oldPath && oldPath.trim() !== "/dev/null") current = open(oldPath);
      } else {
        current = open(path);
      }
      continue;
    }
    const hunk = HUNK_RE.exec(raw);
    if (hunk && current) {
      oldLeft = hunk[1] === undefined ? 1 : Number(hunk[1]);
      newLeft = hunk[3] === undefined ? 1 : Number(hunk[3]);
      const start = Number(hunk[2]);
      newNo = start;
      current.ranges.push([start, start + Math.max(newLeft, 1) - 1]);
      currentHasHunks = true;
    }
  }
  return files;
}

/** Lowers confidence for an issue the diff cannot fully back up. */
function discounted(confidence: number): number {
  return Math.round(confidence * 0.8 * 10_000) / 10_000;
}

/**
 * Anchors LLM-reported issues to the diff. Issues on a non-added line are moved
 * to the nearest added line of that file (ties → earlier) with confidence x0.8.
 * In a file with no added lines an issue is kept only if its line falls inside
 * a hunk's new range. Issues on files outside the diff are kept (confidence
 * x0.8) only when `referenced` says the prompt mentioned that file (e.g. an
 * impacted importer, CHANGELOG.md); otherwise the path is assumed hallucinated
 * and the issue is dropped.
 */
export function anchorIssues(
  issues: readonly Issue[],
  diff: string,
  referenced: (path: string) => boolean = () => false,
): Issue[] {
  const files = collectFileLines(diff);
  const result: Issue[] = [];

  for (const issue of issues) {
    const path = normalizePath(issue.location.file);
    const entry = files.get(path);
    if (!entry) {
      if (path && referenced(path)) {
        result.push({ ...issue, confidence: discounted(issue.confidence) });
      }
      continue;
    }
    const line = issue.location.line;
    const added = entry.added;

    if (added.length === 0) {
      if (
        line !== undefined &&
        entry.ranges.some(([from, to]) => line >= from && line <= to)
      ) {
        result.push({ ...issue });
      }
      continue;
    }
    if (line !== undefined && added.includes(line)) {
      result.push({ ...issue });
      continue;
    }

    const target = line ?? added[0]!;
    let nearest = added[0]!;
    for (const candidate of added) {
      if (Math.abs(candidate - target) < Math.abs(nearest - target)) {
        nearest = candidate;
      }
    }
    const { endLine: _endLine, ...location } = issue.location;
    result.push({
      ...issue,
      confidence: discounted(issue.confidence),
      location: { ...location, line: nearest },
    });
  }
  return result;
}
