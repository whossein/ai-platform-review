/**
 * @ai-review/project-index — Domain contracts for structural indexing (Sub-Phase 2A).
 */

import type { ProjectId, SymbolInfo } from "@ai-review/core";

export type SupportedLanguage =
  | "ts"
  | "tsx"
  | "js"
  | "jsx"
  | "py"
  | "go"
  | "rs"
  | "java"
  | "kt"
  | "rb"
  | "php"
  | "cs"
  | "cpp"
  | "c"
  | "sql"
  | "json"
  | "yaml"
  | "md"
  | "other";

export interface IndexedFileEntry {
  readonly path: string;
  readonly lang: SupportedLanguage;
  readonly size: number;
  readonly lineCount: number;
  /** SHA-256 hex digest of normalized UTF-8 file content. */
  readonly contentHash: string;
  /** Optional Git tree blob SHA for zero-download incremental reuse on remote repositories. */
  readonly gitBlobSha?: string | undefined;
  /** Extracted AST symbols (populated for ts/tsx/js/jsx; empty for other languages). */
  readonly symbols: readonly SymbolInfo[];
  /** Raw import specifiers as written in the source file. */
  readonly imports: readonly string[];
  /** Exported symbol/binding names. */
  readonly exports: readonly string[];
}

export interface WorkspacePackageInfo {
  readonly name: string;
  /** Relative repository directory path (e.g. "packages/core"). */
  readonly rootPath: string;
  /** Resolved relative entry file if present (e.g. "packages/core/src/index.ts"). */
  readonly entryPath?: string | undefined;
}

export interface ProjectImportGraph {
  /** Importer file path -> sorted unique list of resolved internal repository file paths. */
  readonly importsByFile: Readonly<Record<string, readonly string[]>>;
  /** Target file path -> sorted unique list of internal repository file paths that import it. */
  readonly importedByFile: Readonly<Record<string, readonly string[]>>;
  /** Importer file path -> sorted unique list of external/unresolved specifiers. */
  readonly externalImportsByFile: Readonly<Record<string, readonly string[]>>;
  /** Discovered workspace / monorepo packages. */
  readonly workspaces: readonly WorkspacePackageInfo[];
  /** Discovered tsconfig path alias prefixes mapped to repository-relative target patterns. */
  readonly pathAliases: Readonly<Record<string, readonly string[]>>;
}

export interface ProjectIndexStats {
  readonly totalFilesScanned: number;
  readonly indexedFilesCount: number;
  readonly skippedFilesCount: number;
  readonly reusedFilesCount: number;
  readonly downloadedFilesCount: number;
  readonly totalBytes: number;
  readonly totalSymbols: number;
  readonly countsByLanguage: Readonly<Record<string, number>>;
  readonly durationMs: number;
}

export interface ProjectIndexSnapshot {
  readonly schemaVersion: 1;
  readonly projectId: ProjectId;
  readonly ref: string;
  readonly commitSha: string;
  readonly createdAt: string;
  readonly stats: ProjectIndexStats;
  readonly files: readonly IndexedFileEntry[];
  readonly graph: ProjectImportGraph;
}

export interface LatestIndexPointer {
  readonly projectId: ProjectId;
  readonly ref: string;
  readonly commitSha: string;
  readonly updatedAt: string;
}

export type IndexJobPhase =
  | "queued"
  | "resolving_ref"
  | "listing_tree"
  | "fetching_files"
  | "extracting_ast"
  | "building_graph"
  | "persisting"
  | "completed";

export type IndexJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface IndexJobProgress {
  readonly phase: IndexJobPhase;
  readonly done: number;
  readonly total: number;
  readonly message?: string | undefined;
}

export interface IndexJob {
  readonly id: string;
  readonly projectId: ProjectId;
  readonly ref?: string | undefined;
  readonly status: IndexJobStatus;
  readonly progress: IndexJobProgress;
  readonly commitSha?: string | undefined;
  readonly startedAt: string;
  readonly finishedAt?: string | undefined;
  /** Sanitized error message with all tokens/credentials scrubbed. */
  readonly error?: string | undefined;
}

export interface IndexFilterOptions {
  /** Maximum file size in bytes (default: 262_144 = 256 KB). */
  readonly maxFileSizeBytes?: number | undefined;
  /** Maximum number of files to index per snapshot (default: 5_000). */
  readonly maxFiles?: number | undefined;
  /** Additional .gitignore-style glob patterns to exclude. */
  readonly extraIgnorePatterns?: readonly string[] | undefined;
}

export interface IndexOptions extends IndexFilterOptions {
  /** Explicit branch, tag, or commit SHA to index. Defaults to project.defaultBranch or remote default branch. */
  readonly ref?: string | undefined;
  /** Maximum concurrent file fetches (default: 8). */
  readonly fetchConcurrency?: number | undefined;
  /** Maximum Retry-After backoff in ms (default: 60_000). */
  readonly maxRetryAfterMs?: number | undefined;
  /** Maximum rate-limit retries per HTTP request (default: 4). */
  readonly maxRateLimitRetries?: number | undefined;
  /** Optional AbortSignal for cancellation. */
  readonly signal?: AbortSignal | undefined;
  /** Optional progress callback invoked during indexing phases. */
  readonly onProgress?: ((progress: IndexJobProgress) => void) | undefined;
}

export interface GitSourceCredentials {
  readonly token?: string | undefined;
  readonly baseUrl?: string | undefined;
}
