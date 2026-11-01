/**
 * Turns a project index snapshot into compact, review-oriented context.
 *
 * Given the files touched by a change, it reports for each one what it
 * exports, what it imports, and which other files depend on it ("blast
 * radius"), so reviewers can reason about callers they cannot see in the diff.
 */

import { resolveImportAgainstGraph } from "./graph.js";
import {
  extractImportSpecifiers,
  isScriptFile,
  parseDiffChanges,
  type DiffFileChange,
} from "./diff-overlay.js";
import type { ProjectIndexSnapshot } from "./types.js";

export interface ReviewContextOptions {
  /** Maximum changed files to describe (default 15). */
  readonly maxFiles?: number | undefined;
  /** Maximum entries listed per relation (default 8). */
  readonly maxItems?: number | undefined;
  /**
   * The unified diff under review. When given, the index (built from the target
   * branch) is overlaid with the change: new/renamed/deleted files and newly
   * added imports are described even though the index predates them.
   */
  readonly diff?: string | undefined;
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

  const changes: DiffFileChange[] = options.diff ? parseDiffChanges(options.diff) : [];
  const changeByPath = new Map(changes.map((c) => [c.path, c]));
  const knownPaths = new Set<string>(byPath.keys());
  for (const c of changes) {
    if (c.status === "added" || c.status === "renamed") knownPaths.add(c.path);
  }
  const touched = new Set<string>([...changedSet, ...changes.map((c) => c.path), ...changes.flatMap((c) => (c.oldPath ? [c.oldPath] : []))]);

  /** Resolves imports added by a change; internal targets plus unresolved relative ones. */
  const addedImports = (c: DiffFileChange | undefined, path: string) => {
    const internal: string[] = [];
    const broken: string[] = [];
    if (!c || c.status === "deleted" || !isScriptFile(path)) return { internal, broken };
    for (const spec of extractImportSpecifiers(c.addedLines)) {
      const target = resolveImportAgainstGraph(path, spec, snapshot.graph, knownPaths);
      if (target && target !== path) internal.push(target);
      else if (!target && spec.startsWith(".")) broken.push(spec);
    }
    return { internal: [...new Set(internal)].sort(), broken };
  };

  for (const path of changed) {
    const entry = byPath.get(path);
    if (!entry) continue;
    if (lines.length >= maxFiles) break;

    const imports = snapshot.graph.importsByFile[path] ?? [];
    const importers = snapshot.graph.importedByFile[path] ?? [];
    for (const importer of importers) {
      if (!touched.has(importer)) impacted.add(importer);
    }

    const parts: string[] = [];
    if (entry.exports.length > 0) parts.push(`exports ${list(entry.exports, maxItems)}`);
    if (imports.length > 0) parts.push(`imports ${list(imports, maxItems)}`);
    parts.push(
      importers.length > 0
        ? `imported by ${importers.length} file(s): ${list(importers, maxItems)}`
        : "not imported by other indexed files",
    );
    const added = addedImports(changeByPath.get(path), path);
    const newImports = added.internal.filter((t) => !imports.includes(t));
    if (newImports.length > 0) parts.push(`this change adds imports of ${list(newImports, maxItems)}`);
    if (added.broken.length > 0) {
      parts.push(`adds relative import(s) that resolve to no known file: ${list(added.broken, maxItems)}`);
    }
    lines.push(`- ${path}: ${parts.join("; ")}`);
  }

  // Overlay: files the index cannot know about because the change creates, removes or moves them
  for (const c of changes) {
    if (lines.length >= maxFiles) break;
    if (c.status === "added" || (c.status === "renamed" && !byPath.has(c.path))) {
      const added = addedImports(c, c.path);
      const parts = [`${c.status === "added" ? "NEW" : "RENAMED"} file, not in the index`];
      if (added.internal.length > 0) parts.push(`imports ${list(added.internal, maxItems)}`);
      if (added.broken.length > 0) {
        parts.push(`relative import(s) resolving to no known file: ${list(added.broken, maxItems)}`);
      }
      lines.push(`- ${c.path}: ${parts.join("; ")}`);
    }
    const gone = c.status === "deleted" ? c.path : c.status === "renamed" ? c.oldPath : undefined;
    if (gone) {
      const stale = (snapshot.graph.importedByFile[gone] ?? []).filter((f) => !touched.has(f));
      if (stale.length > 0) {
        for (const f of stale) impacted.add(f);
        lines.push(
          `- ${gone}: ${c.status === "deleted" ? "DELETED" : `MOVED to ${c.path}`} by this change but still imported by ${stale.length} untouched file(s): ${list(stale, maxItems)}`,
        );
      }
    }
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
