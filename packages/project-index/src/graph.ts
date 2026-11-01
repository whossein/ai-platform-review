/**
 * Dependency graph, workspace package detection, and tsconfig path-alias resolution.
 */

import * as path from "node:path";
import { normalizeRepoPath } from "./filters.js";
import type {
  IndexedFileEntry,
  ProjectImportGraph,
  WorkspacePackageInfo,
} from "./types.js";

const RESOLVABLE_EXTENSIONS = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
  ".json",
];

const INDEX_CANDIDATES = [
  "/index.ts",
  "/index.tsx",
  "/index.js",
  "/index.jsx",
  "/index.mts",
  "/index.mjs",
];

interface RawPackageJson {
  name?: unknown;
  main?: unknown;
  module?: unknown;
  types?: unknown;
  exports?: unknown;
  workspaces?: unknown;
}

interface RawTsConfig {
  compilerOptions?: {
    baseUrl?: unknown;
    paths?: Record<string, unknown>;
  };
}

/**
 * Strips single-line `//` and multi-line `/* ... * /` comments and trailing commas
 * so `tsconfig.json` (which permits JSONC) parses cleanly with `JSON.parse`.
 */
export function parseJsonc<T = unknown>(raw: string): T | undefined {
  try {
    return JSON.parse(raw) as T;
  } catch {
    try {
      const stripped = raw
        .replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, g) =>
          g ? "" : m,
        )
        .replace(/,\s*([}\]])/g, "$1");
      return JSON.parse(stripped) as T;
    } catch {
      return undefined;
    }
  }
}

function resolveCandidateFile(
  candidateBase: string,
  knownFiles: ReadonlySet<string>,
): string | undefined {
  const normalizedBase = normalizeRepoPath(candidateBase);
  if (!normalizedBase) return undefined;

  if (knownFiles.has(normalizedBase)) {
    return normalizedBase;
  }

  // Handle TypeScript ESM convention where imports end in `.js` / `.jsx` / `.mjs`
  // while actual source files on disk end in `.ts` / `.tsx` / `.mts`.
  if (normalizedBase.endsWith(".js")) {
    const stem = normalizedBase.slice(0, -3);
    if (knownFiles.has(`${stem}.ts`)) return `${stem}.ts`;
    if (knownFiles.has(`${stem}.tsx`)) return `${stem}.tsx`;
  } else if (normalizedBase.endsWith(".jsx")) {
    const stem = normalizedBase.slice(0, -4);
    if (knownFiles.has(`${stem}.tsx`)) return `${stem}.tsx`;
    if (knownFiles.has(`${stem}.ts`)) return `${stem}.ts`;
  } else if (normalizedBase.endsWith(".mjs")) {
    const stem = normalizedBase.slice(0, -4);
    if (knownFiles.has(`${stem}.mts`)) return `${stem}.mts`;
  } else if (normalizedBase.endsWith(".cjs")) {
    const stem = normalizedBase.slice(0, -4);
    if (knownFiles.has(`${stem}.cts`)) return `${stem}.cts`;
  }

  for (const ext of RESOLVABLE_EXTENSIONS) {
    if (!ext) continue;
    const withExt = `${normalizedBase}${ext}`;
    if (knownFiles.has(withExt)) return withExt;
  }

  for (const idx of INDEX_CANDIDATES) {
    const withIdx = `${normalizedBase}${idx}`;
    if (knownFiles.has(withIdx)) return withIdx;
  }

  return undefined;
}

function resolvePackageEntry(
  pkgDir: string,
  pkgJson: RawPackageJson,
  knownFiles: ReadonlySet<string>,
): string | undefined {
  const candidates: string[] = [];

  if (typeof pkgJson.exports === "string") {
    candidates.push(pkgJson.exports);
  } else if (pkgJson.exports && typeof pkgJson.exports === "object") {
    const dotExport = (pkgJson.exports as Record<string, unknown>)["."];
    if (typeof dotExport === "string") {
      candidates.push(dotExport);
    } else if (dotExport && typeof dotExport === "object") {
      const dotObj = dotExport as Record<string, unknown>;
      for (const key of ["types", "import", "default", "require"]) {
        if (typeof dotObj[key] === "string") {
          candidates.push(dotObj[key] as string);
        }
      }
    }
  }

  for (const field of [pkgJson.types, pkgJson.module, pkgJson.main]) {
    if (typeof field === "string" && field.trim()) {
      candidates.push(field.trim());
    }
  }

  candidates.push("src/index.ts", "src/index.tsx", "index.ts", "index.js");

  for (const rel of candidates) {
    const joined = normalizeRepoPath(
      pkgDir ? path.posix.join(pkgDir, rel) : rel,
    );
    const resolved = resolveCandidateFile(joined, knownFiles);
    if (resolved) return resolved;
  }

  return undefined;
}

/**
 * Discovers workspace packages and tsconfig path aliases from config file contents.
 */
export function discoverWorkspacesAndAliases(
  configFilesByPath: ReadonlyMap<string, string>,
  knownFiles: ReadonlySet<string>,
): {
  readonly workspaces: readonly WorkspacePackageInfo[];
  readonly pathAliases: Readonly<Record<string, readonly string[]>>;
} {
  const workspacesByName = new Map<string, WorkspacePackageInfo>();
  const pathAliases: Record<string, string[]> = {};

  const sortedPaths = Array.from(configFilesByPath.keys()).sort();

  for (const filePath of sortedPaths) {
    const normPath = normalizeRepoPath(filePath);
    const content = configFilesByPath.get(filePath) ?? "";

    if (normPath === "package.json" || normPath.endsWith("/package.json")) {
      const parsed = parseJsonc<RawPackageJson>(content);
      if (!parsed || typeof parsed !== "object") continue;

      const pkgDir =
        normPath === "package.json"
          ? ""
          : normPath.slice(0, -"/package.json".length);

      if (typeof parsed.name === "string" && parsed.name.trim()) {
        const name = parsed.name.trim();
        const entryPath = resolvePackageEntry(pkgDir, parsed, knownFiles);
        workspacesByName.set(name, {
          name,
          rootPath: pkgDir || ".",
          ...(entryPath !== undefined ? { entryPath } : {}),
        });
      }
    }

    const baseName = path.posix.basename(normPath);
    if (
      baseName === "tsconfig.json" ||
      baseName === "tsconfig.base.json" ||
      baseName === "jsconfig.json"
    ) {
      const parsed = parseJsonc<RawTsConfig>(content);
      const compilerOptions = parsed?.compilerOptions;
      if (!compilerOptions || typeof compilerOptions !== "object") continue;

      const configDir =
        normPath.indexOf("/") === -1 ? "" : path.posix.dirname(normPath);
      const baseUrl =
        typeof compilerOptions.baseUrl === "string"
          ? compilerOptions.baseUrl
          : ".";
      const baseDir = normalizeRepoPath(
        path.posix.join(configDir || ".", baseUrl),
      );

      if (compilerOptions.paths && typeof compilerOptions.paths === "object") {
        for (const [pattern, targets] of Object.entries(
          compilerOptions.paths,
        )) {
          if (!Array.isArray(targets)) continue;
          const resolvedTargets: string[] = [];
          for (const t of targets) {
            if (typeof t !== "string") continue;
            const joined = normalizeRepoPath(
              path.posix.join(baseDir || ".", t),
            );
            resolvedTargets.push(joined);
          }
          if (resolvedTargets.length > 0) {
            pathAliases[pattern] = resolvedTargets;
          }
        }
      }
    }
  }

  const workspaces = Array.from(workspacesByName.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  return { workspaces, pathAliases };
}

function resolveImportSpecifier(
  importerPath: string,
  specifier: string,
  knownFiles: ReadonlySet<string>,
  workspacesByName: ReadonlyMap<string, WorkspacePackageInfo>,
  pathAliases: Readonly<Record<string, readonly string[]>>,
): string | undefined {
  const trimmed = specifier.trim();
  if (!trimmed) return undefined;

  // 1. Relative import (`./...` or `../...`)
  if (trimmed.startsWith(".")) {
    const importerDir = path.posix.dirname(normalizeRepoPath(importerPath));
    const joined = path.posix.join(
      importerDir === "." ? "" : importerDir,
      trimmed,
    );
    return resolveCandidateFile(joined, knownFiles);
  }

  // 2. tsconfig path aliases (exact match or wildcard `alias/*` -> `target/*`)
  for (const [pattern, targets] of Object.entries(pathAliases)) {
    const starIdx = pattern.indexOf("*");
    if (starIdx === -1) {
      if (trimmed === pattern) {
        for (const target of targets) {
          const hit = resolveCandidateFile(target, knownFiles);
          if (hit) return hit;
        }
      }
    } else {
      const prefix = pattern.slice(0, starIdx);
      const suffix = pattern.slice(starIdx + 1);
      if (trimmed.startsWith(prefix) && trimmed.endsWith(suffix)) {
        const matchedMiddle = trimmed.slice(
          prefix.length,
          trimmed.length - suffix.length,
        );
        for (const targetPattern of targets) {
          const replaced = targetPattern.replace("*", matchedMiddle);
          const hit = resolveCandidateFile(replaced, knownFiles);
          if (hit) return hit;
        }
      }
    }
  }

  // 3. Monorepo workspace package import (`@scope/pkg` or `@scope/pkg/subpath`)
  for (const [pkgName, pkgInfo] of workspacesByName.entries()) {
    if (trimmed === pkgName) {
      if (pkgInfo.entryPath && knownFiles.has(pkgInfo.entryPath)) {
        return pkgInfo.entryPath;
      }
      const rootDir = pkgInfo.rootPath === "." ? "" : pkgInfo.rootPath;
      const fallback = resolveCandidateFile(
        rootDir ? `${rootDir}/src/index` : "src/index",
        knownFiles,
      );
      if (fallback) return fallback;
    } else if (trimmed.startsWith(`${pkgName}/`)) {
      const subPath = trimmed.slice(pkgName.length + 1);
      const rootDir = pkgInfo.rootPath === "." ? "" : pkgInfo.rootPath;
      for (const candidatePrefix of [
        rootDir ? `${rootDir}/src/${subPath}` : `src/${subPath}`,
        rootDir ? `${rootDir}/${subPath}` : subPath,
      ]) {
        const hit = resolveCandidateFile(candidatePrefix, knownFiles);
        if (hit) return hit;
      }
    }
  }

  return undefined;
}

/**
 * Builds the deterministic forward and reverse dependency graph over all indexed files.
 */
export function buildImportGraph(
  files: readonly IndexedFileEntry[],
  configFilesByPath: ReadonlyMap<string, string> = new Map(),
): ProjectImportGraph {
  const knownFiles = new Set<string>(
    files.map((f) => normalizeRepoPath(f.path)),
  );
  const { workspaces, pathAliases } = discoverWorkspacesAndAliases(
    configFilesByPath,
    knownFiles,
  );

  const workspacesByName = new Map<string, WorkspacePackageInfo>(
    workspaces.map((w) => [w.name, w]),
  );

  const importsByFileMutable: Record<string, Set<string>> = {};
  const importedByFileMutable: Record<string, Set<string>> = {};
  const externalImportsByFileMutable: Record<string, Set<string>> = {};

  for (const file of files) {
    const normPath = normalizeRepoPath(file.path);
    importsByFileMutable[normPath] = new Set<string>();
    if (!importedByFileMutable[normPath]) {
      importedByFileMutable[normPath] = new Set<string>();
    }
    externalImportsByFileMutable[normPath] = new Set<string>();
  }

  for (const file of files) {
    const importerPath = normalizeRepoPath(file.path);
    for (const specifier of file.imports) {
      const resolvedTarget = resolveImportSpecifier(
        importerPath,
        specifier,
        knownFiles,
        workspacesByName,
        pathAliases,
      );
      if (resolvedTarget && resolvedTarget !== importerPath) {
        importsByFileMutable[importerPath]!.add(resolvedTarget);
        if (!importedByFileMutable[resolvedTarget]) {
          importedByFileMutable[resolvedTarget] = new Set<string>();
        }
        importedByFileMutable[resolvedTarget]!.add(importerPath);
      } else if (!resolvedTarget) {
        externalImportsByFileMutable[importerPath]!.add(specifier);
      }
    }
  }

  const sortedFileKeys = Object.keys(importsByFileMutable).sort();
  const importsByFile: Record<string, readonly string[]> = {};
  const importedByFile: Record<string, readonly string[]> = {};
  const externalImportsByFile: Record<string, readonly string[]> = {};

  for (const key of sortedFileKeys) {
    importsByFile[key] = Array.from(importsByFileMutable[key] ?? []).sort();
    importedByFile[key] = Array.from(importedByFileMutable[key] ?? []).sort();
    const ext = Array.from(externalImportsByFileMutable[key] ?? []).sort();
    if (ext.length > 0) {
      externalImportsByFile[key] = ext;
    }
  }

  return {
    importsByFile,
    importedByFile,
    externalImportsByFile,
    workspaces,
    pathAliases,
  };
}
