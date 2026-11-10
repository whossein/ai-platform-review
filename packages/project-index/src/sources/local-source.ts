/**
 * Local filesystem repository source for @ai-review/project-index.
 *
 * Reuses `@ai-review/repository` (`LocalFolderRepository` and `safeResolve`) for
 * path-traversal-safe file access, and resolves the current Git commit SHA from
 * `.git/HEAD` (or computes a deterministic synthetic tree hash when `.git` is absent).
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { LocalFolderRepository } from "@ai-review/repository";
import { normalizeRepoPath } from "../filters.js";
import {
  throwIfAborted,
  type RepositorySource,
  type ResolvedRef,
  type SourceTreeEntry,
} from "./source.js";

function safeResolve(rootDir: string, relPath: string): string | undefined {
  const abs = path.resolve(rootDir, relPath);
  const rel = path.relative(rootDir, abs);
  if (rel.startsWith("..") || rel.includes(`..${path.sep}`)) {
    return undefined;
  }
  return abs;
}

export interface LocalSourceOptions {
  readonly rootDir: string;
  readonly defaultBranch?: string | undefined;
}

export class LocalRepositorySource implements RepositorySource {
  readonly kind = "local" as const;
  private readonly rootDir: string;
  private readonly defaultBranch: string;
  private readonly localRepo: LocalFolderRepository;

  constructor(options: LocalSourceOptions) {
    this.rootDir = path.resolve(options.rootDir);
    this.defaultBranch = options.defaultBranch ?? "local";
    this.localRepo = new LocalFolderRepository(this.rootDir);
  }

  async resolveRef(
    ref?: string | undefined,
    signal?: AbortSignal | undefined,
  ): Promise<ResolvedRef> {
    throwIfAborted(signal);
    const gitResolved = await this.tryResolveGitHead(ref);
    if (gitResolved) {
      return gitResolved;
    }

    // Fallback for non-git local folders: compute a deterministic synthetic 40-char SHA
    // from all file paths, sizes, and mtimes/contents.
    const entries = await this.scanLocalFiles(signal);
    const hash = createHash("sha256");
    for (const entry of entries) {
      hash.update(`${entry.path}:${entry.size ?? 0}:${entry.gitBlobSha ?? ""}\n`);
    }
    const syntheticSha = hash.digest("hex").slice(0, 40);
    return {
      ref: ref?.trim() || this.defaultBranch,
      commitSha: syntheticSha,
    };
  }

  private async tryResolveGitHead(
    explicitRef?: string | undefined,
  ): Promise<ResolvedRef | undefined> {
    try {
      const gitDir = path.join(this.rootDir, ".git");
      const stat = await fs.stat(gitDir);
      if (!stat.isDirectory()) return undefined;

      if (explicitRef && /^[0-9a-f]{40}$/i.test(explicitRef.trim())) {
        return { ref: explicitRef.trim(), commitSha: explicitRef.trim().toLowerCase() };
      }

      const headContent = (
        await fs.readFile(path.join(gitDir, "HEAD"), "utf8")
      ).trim();

      if (headContent.startsWith("ref:")) {
        const refPath = headContent.slice(4).trim(); // e.g. refs/heads/main
        const branchName = refPath.replace(/^refs\/heads\//, "");
        const targetRefPath = explicitRef?.trim()
          ? `refs/heads/${explicitRef.trim().replace(/^refs\/heads\//, "")}`
          : refPath;

        try {
          const refFile = path.resolve(gitDir, targetRefPath);
          // A ref like "../../etc/passwd" must not read outside .git/.
          if (!refFile.startsWith(path.resolve(gitDir) + path.sep)) return undefined;
          const sha = (await fs.readFile(refFile, "utf8")).trim();
          if (/^[0-9a-f]{40}$/i.test(sha)) {
            return {
              ref: explicitRef?.trim() || branchName,
              commitSha: sha.toLowerCase(),
            };
          }
        } catch {
          // Check packed-refs fallback
          const packedRefsPath = path.join(gitDir, "packed-refs");
          const packed = await fs.readFile(packedRefsPath, "utf8");
          for (const line of packed.split(/\r?\n/)) {
            if (!line || line.startsWith("#") || line.startsWith("^")) continue;
            const [sha, rName] = line.trim().split(/\s+/);
            if (sha && rName === targetRefPath && /^[0-9a-f]{40}$/i.test(sha)) {
              return {
                ref: explicitRef?.trim() || branchName,
                commitSha: sha.toLowerCase(),
              };
            }
          }
        }
      } else if (/^[0-9a-f]{40}$/i.test(headContent)) {
        return {
          ref: explicitRef?.trim() || "HEAD",
          commitSha: headContent.toLowerCase(),
        };
      }
    } catch {
      // Not a git checkout or unreadable .git; fall through to synthetic SHA
    }
    return undefined;
  }

  private async scanLocalFiles(
    signal?: AbortSignal | undefined,
  ): Promise<SourceTreeEntry[]> {
    const out: SourceTreeEntry[] = [];

    const walk = async (relDir: string): Promise<void> => {
      throwIfAborted(signal);
      const absDir = safeResolve(this.rootDir, relDir || ".");
      if (!absDir) return;
      let dirents;
      try {
        dirents = await fs.readdir(absDir, { withFileTypes: true });
      } catch {
        return;
      }

      dirents.sort((a, b) => a.name.localeCompare(b.name));
      for (const d of dirents) {
        throwIfAborted(signal);
        if (d.name === ".git" || d.name === "node_modules") continue;
        const rel = normalizeRepoPath(
          relDir ? `${relDir}/${d.name}` : d.name,
        );
        if (d.isDirectory()) {
          await walk(rel);
        } else if (d.isFile()) {
          const absFile = safeResolve(this.rootDir, rel);
          if (!absFile) continue;
          try {
            const st = await fs.stat(absFile);
            const buf = await fs.readFile(absFile);
            const gitBlobSha = createHash("sha1")
              .update(`blob ${buf.byteLength}\0`)
              .update(buf)
              .digest("hex");
            out.push({
              path: rel,
              size: st.size,
              gitBlobSha,
            });
          } catch {
            // Ignore unreadable transient files
          }
        }
      }
    };

    await walk("");
    return out;
  }

  async listTree(
    _commitSha: string,
    signal?: AbortSignal | undefined,
  ): Promise<readonly SourceTreeEntry[]> {
    return this.scanLocalFiles(signal);
  }

  async readFile(
    entry: SourceTreeEntry,
    _commitSha: string,
    signal?: AbortSignal | undefined,
  ): Promise<string> {
    throwIfAborted(signal);
    const res = await this.localRepo.readFile(entry.path);
    if (!res.ok) {
      throw new Error(res.error.message);
    }
    if (res.value === undefined) {
      throw new Error(`Local file not found: ${entry.path}`);
    }
    return res.value;
  }
}
