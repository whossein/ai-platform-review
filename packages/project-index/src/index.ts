/**
 * @ai-review/project-index
 *
 * Sub-Phase 2A — Structural Repository Index:
 *  - Multi-source repository acquisition (GitLab REST v4, GitHub Trees/Blobs API, Local checkout)
 *  - `.gitignore`-style filtering, binary & size caps, language classification
 *  - TypeScript/JavaScript AST symbol/import/export extraction (`@ai-review/context-engine`)
 *  - Monorepo workspace (`package.json`) and `tsconfig.json` path-alias dependency graph
 *  - Incremental re-indexing by `gitBlobSha` and SHA-256 `contentHash`
 *  - Atomic snapshot storage (`.data/index/<projectId>/<commitSha>.json` + `latest.json`) with retention
 *  - Rate-limit-aware, cancellable `IndexJobManager` with strict secret redaction
 */

export * from "./types.js";
export * from "./redact.js";
export * from "./filters.js";
export * from "./graph.js";
export * from "./store.js";
export * from "./indexer.js";
export * from "./job-manager.js";
export * from "./sources/source.js";
export * from "./sources/gitlab-source.js";
export * from "./sources/github-source.js";
export * from "./sources/local-source.js";
export * from "./review-context.js";
