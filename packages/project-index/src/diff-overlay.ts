/**
 * Lightweight reading of a unified diff for index overlay: which files were
 * added, deleted or renamed, and which imports the change adds. This lets
 * review context describe files the (older) index does not know about.
 */

export interface DiffFileChange {
  readonly path: string;
  readonly oldPath?: string | undefined;
  readonly status: "added" | "modified" | "deleted" | "renamed";
  readonly addedLines: readonly string[];
}

const DEV_NULL = "/dev/null";

function stripPrefix(p: string): string {
  return p.replace(/^[ab]\//, "").trim();
}

export function parseDiffChanges(diff: string): DiffFileChange[] {
  interface Draft {
    path: string;
    oldPath?: string;
    added: boolean;
    deleted: boolean;
    renamed: boolean;
    addedLines: string[];
    inHunk: boolean;
  }
  const out: DiffFileChange[] = [];
  let cur: Draft | undefined;

  const flush = () => {
    if (!cur) return;
    const path = cur.deleted ? (cur.oldPath ?? cur.path) : cur.path;
    if (path && path !== DEV_NULL) {
      out.push({
        path,
        ...(cur.oldPath && cur.oldPath !== path ? { oldPath: cur.oldPath } : {}),
        status: cur.deleted
          ? "deleted"
          : cur.added
            ? "added"
            : cur.renamed
              ? "renamed"
              : "modified",
        addedLines: cur.addedLines,
      });
    }
    cur = undefined;
  };
  const start = (oldPath: string, path: string): Draft => ({
    path,
    oldPath,
    added: false,
    deleted: false,
    renamed: false,
    addedLines: [],
    inHunk: false,
  });

  const lines = diff.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const git = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (git) {
      flush();
      cur = start(git[1]!, git[2]!);
      continue;
    }
    if (cur && !cur.inHunk) {
      if (line.startsWith("new file mode")) cur.added = true;
      else if (line.startsWith("deleted file mode")) cur.deleted = true;
      else if (line.startsWith("rename from ")) {
        cur.renamed = true;
        cur.oldPath = line.slice(12).trim();
      } else if (line.startsWith("rename to ")) {
        cur.path = line.slice(10).trim();
      }
    }
    // File header pair; "--- " alone could be a removed line starting with "-- "
    if (line.startsWith("--- ") && (lines[i + 1] ?? "").startsWith("+++ ") && !(cur?.inHunk && !lines[i + 2]?.startsWith("@@"))) {
      const oldP = line.slice(4).trim();
      const newP = lines[i + 1]!.slice(4).trim();
      if (!cur || cur.inHunk) {
        flush();
        cur = start(stripPrefix(oldP), stripPrefix(newP));
      }
      if (oldP === DEV_NULL) cur.added = true;
      if (newP === DEV_NULL) cur.deleted = true;
      if (newP !== DEV_NULL) cur.path = stripPrefix(newP);
      if (oldP !== DEV_NULL) cur.oldPath = stripPrefix(oldP);
      cur.inHunk = false;
      i++;
      continue;
    }
    if (!cur) continue;
    if (line.startsWith("@@")) {
      cur.inHunk = true;
    } else if (cur.inHunk && line.startsWith("+")) {
      cur.addedLines.push(line.slice(1));
    }
  }
  flush();
  return out;
}

const SCRIPT_FILE = /\.(?:[cm]?[jt]sx?)$/;

export function isScriptFile(path: string): boolean {
  return SCRIPT_FILE.test(path);
}

/** Module specifiers referenced by import/export-from/require/dynamic import in the given source lines. */
export function extractImportSpecifiers(lines: readonly string[]): string[] {
  const text = lines.join("\n");
  const found = new Set<string>();
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[^'"`;]*?\s+from\s+)?['"]([^'"\n]+)['"]/g,
    /\brequire\(\s*['"]([^'"\n]+)['"]\s*\)/g,
    /\bimport\(\s*['"]([^'"\n]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) found.add(m[1]!);
  }
  return [...found];
}
