/**
 * Turns a project index snapshot into compact, review-oriented context.
 *
 * Given the files touched by a change, it reports for each one what it
 * exports, what it imports, and which other files depend on it ("blast
 * radius"), so reviewers can reason about callers they cannot see in the diff.
 */

import type { ProjectIndexSnapshot } from "./types.js";

export interface ReviewContextOptions {
  /** Maximum changed files to describe (default 15). */
  readonly maxFiles?: number | undefined;
  /** Maximum entries listed per relation (default 8). */
  readonly maxItems?: number | undefined;
}

function list(items: readonly string[], max: number): string {
  const shown = items.slice(0, max).join(", ");
  return items.length > max ? `${shown} (+${items.length - max} more)` : shown;
}

/** Strips git diff prefixes so diff paths match index paths. */
function normalize(p: string): string {
  return p.replace(/^[ab]\//, "").replace(/^\.\//, "");
}

/**
 * Returns a text block describing the structural neighbourhood of `changedPaths`,
 * or `""` when none of them are present in the snapshot.
 */
export function buildReviewContext(
  snapshot: ProjectIndexSnapshot,
  changedPaths: readonly string[],
  options: ReviewContextOptions = {},
): string {
  const maxFiles = options.maxFiles ?? 15;
  const maxItems = options.maxItems ?? 8;

  const byPath = new Map(snapshot.files.map((f) => [f.path, f]));
  const changed = [...new Set(changedPaths.map(normalize))];
  const changedSet = new Set(changed);

  const lines: string[] = [];
  const impacted = new Set<string>();

  for (const path of changed) {
    const entry = byPath.get(path);
    if (!entry) continue;
    if (lines.length >= maxFiles) break;

    const imports = snapshot.graph.importsByFile[path] ?? [];
    const importers = snapshot.graph.importedByFile[path] ?? [];
    for (const importer of importers) {
      if (!changedSet.has(importer)) impacted.add(importer);
    }

    const parts: string[] = [];
    if (entry.exports.length > 0) parts.push(`exports ${list(entry.exports, maxItems)}`);
    if (imports.length > 0) parts.push(`imports ${list(imports, maxItems)}`);
    parts.push(
      importers.length > 0
        ? `imported by ${importers.length} file(s): ${list(importers, maxItems)}`
        : "not imported by other indexed files",
    );
    lines.push(`- ${path}: ${parts.join("; ")}`);
  }

  if (lines.length === 0) return "";

  const header = `--- PROJECT STRUCTURE (index of ${snapshot.ref}@${snapshot.commitSha.slice(0, 8)}) ---`;
  const out = [header, ...lines];
  if (impacted.size > 0) {
    out.push(
      `Files that depend on the changed files but are not part of this change (check for breakage): ${list([...impacted].sort(), maxItems * 2)}`,
    );
  }
  return out.join("\n");
}
