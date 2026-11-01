/**
 * Core structural repository indexer (`ProjectIndexer`).
 *
 * Orchestrates:
 *  1. Ref & commitSha resolution
 *  2. Tree listing & `.gitignore` discovery
 *  3. Path filtering, binary exclusion, and size/file-count enforcement
 *  4. Incremental reuse (skips raw download when `gitBlobSha` matches previous snapshot,
 *     and reuses parsed AST when `contentHash` matches)
 *  5. Bounded-concurrency file fetching
 *  6. `extractFile()` AST extraction for TS/TSX/JS/JSX and metadata-only for other languages
 *  7. Workspace & tsconfig import graph construction
 *  8. Atomic snapshot persistence via `ProjectIndexStore`
 */

import { createHash } from "node:crypto";
import type { ProjectId } from "@ai-review/core";
import { extractFile } from "@ai-review/context-engine";
import {
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_FILE_SIZE_BYTES,
  PathFilter,
  detectLanguage,
  isAstExtractableLanguage,
  isBinaryContent,
  normalizeRepoPath,
  parseGitignorePatterns,
} from "./filters.js";
import { buildImportGraph } from "./graph.js";
import type {
   RepositorySource,
  SourceTreeEntry,
} from "./sources/source.js";
import { throwIfAborted } from "./sources/source.js";
import type { ProjectIndexStore } from "./store.js";
import type {
  IndexJobProgress,
  IndexOptions,
  IndexedFileEntry,
  ProjectIndexSnapshot,
  ProjectIndexStats,
} from "./types.js";

export const DEFAULT_FETCH_CONCURRENCY = 8;

export function computeContentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function countLines(content: string): number {
  if (content.length === 0) return 0;
  let count = 1;
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) count++;
  }
  return count;
}

function isGraphConfigFile(normalizedPath: string): boolean {
  if (
    normalizedPath === "package.json" ||
    normalizedPath.endsWith("/package.json")
  ) {
    return true;
  }
  const slashIdx = normalizedPath.lastIndexOf("/");
  const baseName =
    slashIdx === -1 ? normalizedPath : normalizedPath.slice(slashIdx + 1);
  return (
    baseName === "tsconfig.json" ||
    baseName === "tsconfig.base.json" ||
    baseName === "jsconfig.json"
  );
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const runners = Array.from({ length: limit }, async () => {
    while (true) {
      const idx = nextIndex++;
      if (idx >= items.length) break;
      results[idx] = await worker(items[idx]!, idx);
    }
  });

  await Promise.all(runners);
  return results;
}

export class ProjectIndexer {
  constructor(private readonly store: ProjectIndexStore) {}

  async indexRepository(
    projectId: ProjectId,
    source: RepositorySource,
    options?: IndexOptions,
  ): Promise<ProjectIndexSnapshot> {
    const startTime = Date.now();
    const signal = options?.signal;
    const report = (progress: IndexJobProgress) => {
      options?.onProgress?.(progress);
    };

    throwIfAborted(signal);
    report({
      phase: "resolving_ref",
      done: 0,
      total: 1,
      message: "Resolving target reference and commit SHA",
    });

    const resolvedRef = await source.resolveRef(options?.ref, signal);
    throwIfAborted(signal);

    report({
      phase: "listing_tree",
      done: 0,
      total: 1,
      message: `Listing repository tree at ${resolvedRef.commitSha.slice(0, 8)}`,
    });

    const rawTree = await source.listTree(resolvedRef.commitSha, signal);
    throwIfAborted(signal);

    // Check for root `.gitignore` in the tree to augment ignore patterns
    let gitignorePatterns: string[] = [];
    const rootGitignoreEntry = rawTree.find(
      (e) => normalizeRepoPath(e.path) === ".gitignore",
    );
    if (rootGitignoreEntry) {
      try {
        const gitignoreText = await source.readFile(
          rootGitignoreEntry,
          resolvedRef.commitSha,
          signal,
        );
        gitignorePatterns = parseGitignorePatterns(gitignoreText);
      } catch {
        // Proceed with default ignore rules if .gitignore cannot be read
      }
    }

    const filter = new PathFilter({
      maxFileSizeBytes:
        options?.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES,
      maxFiles: options?.maxFiles ?? DEFAULT_MAX_FILES,
      extraIgnorePatterns: [
        ...gitignorePatterns,
        ...(options?.extraIgnorePatterns ?? []),
      ],
    });

    // Load previous snapshot for incremental reuse
    const previousSnapshot =
      (await this.store.getSnapshotForRef(projectId, resolvedRef.ref)) ??
      (await this.store.getLatestSnapshot(projectId));
    const previousByPath = new Map<string, IndexedFileEntry>();
    if (previousSnapshot) {
      for (const prevFile of previousSnapshot.files) {
        previousByPath.set(normalizeRepoPath(prevFile.path), prevFile);
      }
    }

    // Deduplicate and sort candidate tree entries deterministically by normalized path
    const dedupedByPath = new Map<string, SourceTreeEntry>();
    for (const entry of rawTree) {
      const normPath = normalizeRepoPath(entry.path);
      if (normPath && !dedupedByPath.has(normPath)) {
        dedupedByPath.set(normPath, { ...entry, path: normPath });
      }
    }
    const sortedTree = Array.from(dedupedByPath.values()).sort((a, b) =>
      a.path.localeCompare(b.path),
    );

    const eligibleEntries: SourceTreeEntry[] = [];
    let skippedFilesCount = 0;

    for (const entry of sortedTree) {
      const normPath = entry.path;
      if (filter.shouldExcludePath(normPath)) {
        skippedFilesCount++;
        continue;
      }
      if (!filter.isAllowedSize(entry.size)) {
        skippedFilesCount++;
        continue;
      }
      if (eligibleEntries.length >= filter.maxFiles) {
        skippedFilesCount++;
        continue;
      }
      eligibleEntries.push({
        ...entry,
        path: normPath,
      });
    }

    const concurrency =
      options?.fetchConcurrency ?? DEFAULT_FETCH_CONCURRENCY;
    let fetchedDone = 0;
    let reusedFilesCount = 0;
    let downloadedFilesCount = 0;
    const configFilesByPath = new Map<string, string>();

    report({
      phase: "fetching_files",
      done: 0,
      total: eligibleEntries.length,
      message: `Processing ${eligibleEntries.length} repository files`,
    });

    const processedEntries = await mapWithConcurrency(
      eligibleEntries,
      concurrency,
      async (entry): Promise<IndexedFileEntry | null> => {
        throwIfAborted(signal);
        const normPath = entry.path;
        const prev = previousByPath.get(normPath);
        const needsConfigContent = isGraphConfigFile(normPath);

        // Fast-path 1: gitBlobSha matches previous snapshot and it is not a workspace/tsconfig file
        if (
          prev &&
          entry.gitBlobSha &&
          prev.gitBlobSha &&
          entry.gitBlobSha === prev.gitBlobSha &&
          !needsConfigContent
        ) {
          reusedFilesCount++;
          fetchedDone++;
          report({
            phase: "fetching_files",
            done: fetchedDone,
            total: eligibleEntries.length,
          });
          return prev;
        }

        // Otherwise read content from source
        const content = await source.readFile(
          entry,
          resolvedRef.commitSha,
          signal,
        );
        downloadedFilesCount++;
        throwIfAborted(signal);

        const byteLength = Buffer.byteLength(content, "utf8");
        if (!filter.isAllowedSize(byteLength) || isBinaryContent(content)) {
          skippedFilesCount++;
          fetchedDone++;
          report({
            phase: "fetching_files",
            done: fetchedDone,
            total: eligibleEntries.length,
          });
          return null;
        }

        if (needsConfigContent) {
          configFilesByPath.set(normPath, content);
        }

        const contentHash = computeContentHash(content);

        // Fast-path 2: contentHash matches previous snapshot entry -> reuse AST extraction
        if (prev && prev.contentHash === contentHash) {
          reusedFilesCount++;
          fetchedDone++;
          report({
            phase: "fetching_files",
            done: fetchedDone,
            total: eligibleEntries.length,
          });
          return {
            ...prev,
            size: byteLength,
            ...(entry.gitBlobSha !== undefined
              ? { gitBlobSha: entry.gitBlobSha }
              : {}),
          };
        }

        const lang = detectLanguage(normPath);
        const lineCount = countLines(content);

        let symbols: IndexedFileEntry["symbols"] = [];
        let imports: IndexedFileEntry["imports"] = [];
        let exportsList: IndexedFileEntry["exports"] = [];

        if (isAstExtractableLanguage(lang)) {
          const extracted = extractFile(normPath, content, new Set<number>());
          symbols = extracted.symbols;
          imports = extracted.imports;
          exportsList = extracted.exports;
        }

        fetchedDone++;
        report({
          phase: "extracting_ast",
          done: fetchedDone,
          total: eligibleEntries.length,
        });

        return {
          path: normPath,
          lang,
          size: byteLength,
          lineCount,
          contentHash,
          ...(entry.gitBlobSha !== undefined
            ? { gitBlobSha: entry.gitBlobSha }
            : {}),
          symbols,
          imports,
          exports: exportsList,
        };
      },
    );

    throwIfAborted(signal);

    const indexedFiles: IndexedFileEntry[] = processedEntries
      .filter((item): item is IndexedFileEntry => item !== null)
      .sort((a, b) => a.path.localeCompare(b.path));

    report({
      phase: "building_graph",
      done: 0,
      total: indexedFiles.length,
      message: "Building import and reverse-dependency graph",
    });

    const graph = buildImportGraph(indexedFiles, configFilesByPath);

    const countsByLanguage: Record<string, number> = {};
    let totalBytes = 0;
    let totalSymbols = 0;

    for (const f of indexedFiles) {
      countsByLanguage[f.lang] = (countsByLanguage[f.lang] ?? 0) + 1;
      totalBytes += f.size;
      totalSymbols += f.symbols.length;
    }

    const durationMs = Math.max(1, Date.now() - startTime);
    const stats: ProjectIndexStats = {
      totalFilesScanned: rawTree.length,
      indexedFilesCount: indexedFiles.length,
      skippedFilesCount,
      reusedFilesCount,
      downloadedFilesCount,
      totalBytes,
      totalSymbols,
      countsByLanguage,
      durationMs,
    };

    const snapshot: ProjectIndexSnapshot = {
      schemaVersion: 1,
      projectId,
      ref: resolvedRef.ref,
      commitSha: resolvedRef.commitSha,
      createdAt: new Date().toISOString(),
      stats,
      files: indexedFiles,
      graph,
    };

    throwIfAborted(signal);
    report({
      phase: "persisting",
      done: indexedFiles.length,
      total: indexedFiles.length,
      message: "Persisting snapshot atomically",
    });

    await this.store.saveSnapshot(snapshot);

    report({
      phase: "completed",
      done: indexedFiles.length,
      total: indexedFiles.length,
      message: "Indexing completed",
    });

    return snapshot;
  }
}
