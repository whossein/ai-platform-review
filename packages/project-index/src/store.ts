/**
 * Crash-safe atomic storage for ProjectIndexSnapshots, latest pointer, and IndexJobs.
 *
 * Follows the exact serialized `writeQueue` + `.tmp.${Date.now()}` + `fs.rename`
 * pattern used by `ProjectStore` (`apps/api/src/project-store.ts`).
 *
 * Directory layout:
 *   <baseDir>/<projectId>/<commitSha>.json
 *   <baseDir>/<projectId>/latest.json   (most recently indexed ref, any branch)
 *   <baseDir>/<projectId>/refs.json     (newest pointer per ref/branch)
 *   <baseDir>/<projectId>/job.json
 *   <baseDir>/<projectId>/history.json  (finished jobs, newest first, capped)
 */

import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { ProjectId } from "@ai-review/core";
import type {
  IndexHistoryEntry,
  IndexJob,
  LatestIndexPointer,
  ProjectIndexSnapshot,
} from "./types.js";

export const DEFAULT_SNAPSHOT_RETENTION = 3;
/** Maximum distinct refs (branches) that keep their own pointer and snapshot. */
export const MAX_TRACKED_REFS = 8;
/** Finished jobs kept per project for the history view. */
export const MAX_HISTORY_ENTRIES = 50;

const RESERVED_FILES = new Set(["latest.json", "refs.json", "job.json", "history.json"]);

export interface ProjectIndexStoreOptions {
  readonly baseDir?: string | undefined;
  readonly retentionCount?: number | undefined;
}

function sanitizeSegment(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export class ProjectIndexStore {
  private readonly baseDir: string;
  private readonly retentionCount: number;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(options?: string | ProjectIndexStoreOptions) {
    if (typeof options === "string") {
      this.baseDir = path.resolve(options);
      this.retentionCount = DEFAULT_SNAPSHOT_RETENTION;
    } else {
      this.baseDir = path.resolve(options?.baseDir ?? "./.data/index");
      this.retentionCount = Math.max(
        1,
        options?.retentionCount ?? DEFAULT_SNAPSHOT_RETENTION,
      );
    }
  }

  private projectDir(projectId: ProjectId | string): string {
    return path.join(this.baseDir, sanitizeSegment(String(projectId)));
  }

  private snapshotPath(projectId: ProjectId | string, commitSha: string): string {
    return path.join(
      this.projectDir(projectId),
      `${sanitizeSegment(commitSha)}.json`,
    );
  }

  private latestPointerPath(projectId: ProjectId | string): string {
    return path.join(this.projectDir(projectId), "latest.json");
  }

  private refsPointerPath(projectId: ProjectId | string): string {
    return path.join(this.projectDir(projectId), "refs.json");
  }

  private async readRefs(
    projectId: ProjectId | string,
  ): Promise<Record<string, LatestIndexPointer>> {
    try {
      const raw = await fs.readFile(this.refsPointerPath(projectId), "utf8");
      return JSON.parse(raw) as Record<string, LatestIndexPointer>;
    } catch {
      return {};
    }
  }

  private jobFilePath(projectId: ProjectId | string): string {
    return path.join(this.projectDir(projectId), "job.json");
  }

  private enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(fn, fn);
    this.writeQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async atomicWriteJson(
    targetPath: string,
    payload: unknown,
  ): Promise<void> {
    const dir = path.dirname(targetPath);
    await fs.mkdir(dir, { recursive: true });
    const suffix = `${Date.now()}.${randomBytes(4).toString("hex")}`;
    const tmpPath = `${targetPath}.tmp.${suffix}`;
    const serialized = JSON.stringify(payload, null, 2);
    await fs.writeFile(tmpPath, serialized, "utf8");
    await fs.rename(tmpPath, targetPath);
  }

  /**
   * Atomically writes `<commitSha>.json`, updates `latest.json`, and prunes older snapshots
   * exceeding `retentionCount`.
   */
  async saveSnapshot(snapshot: ProjectIndexSnapshot): Promise<void> {
    await this.enqueueWrite(async () => {
      const snapFile = this.snapshotPath(
        snapshot.projectId,
        snapshot.commitSha,
      );
      await this.atomicWriteJson(snapFile, snapshot);

      const pointer: LatestIndexPointer = {
        projectId: snapshot.projectId,
        ref: snapshot.ref,
        commitSha: snapshot.commitSha,
        updatedAt: snapshot.createdAt,
      };
      await this.atomicWriteJson(
        this.latestPointerPath(snapshot.projectId),
        pointer,
      );

      // Per-ref pointer: indexing one branch must not replace another's index.
      const refs = await this.readRefs(snapshot.projectId);
      refs[snapshot.ref] = pointer;
      const kept = Object.entries(refs)
        .sort((a, b) => Date.parse(b[1].updatedAt) - Date.parse(a[1].updatedAt))
        .slice(0, MAX_TRACKED_REFS);
      await this.atomicWriteJson(
        this.refsPointerPath(snapshot.projectId),
        Object.fromEntries(kept),
      );

      await this.pruneOldSnapshotsInternal(
        snapshot.projectId,
        new Set(kept.map(([, p]) => p.commitSha)),
      );
    });
  }

  private async pruneOldSnapshotsInternal(
    projectId: ProjectId | string,
    protectedShas: ReadonlySet<string>,
  ): Promise<void> {
    const dir = this.projectDir(projectId);
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return;
    }

    const reservedNames = RESERVED_FILES;
    const snapshotFiles: Array<{
      name: string;
      fullPath: string;
      createdAtMs: number;
      commitSha: string;
    }> = [];

    for (const name of entries) {
      if (
        !name.endsWith(".json") ||
        reservedNames.has(name) ||
        name.startsWith("profile.") ||
        name.startsWith("embeddings.") ||
        name.includes(".tmp.")
      ) {
        continue;
      }

      const fullPath = path.join(dir, name);
      try {
        const raw = await fs.readFile(fullPath, "utf8");
        const parsed = JSON.parse(raw) as Partial<ProjectIndexSnapshot>;
        const createdAtMs = parsed.createdAt
          ? Date.parse(parsed.createdAt)
          : 0;
        snapshotFiles.push({
          name,
          fullPath,
          createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : 0,
          commitSha: parsed.commitSha ?? name.slice(0, -5),
        });
      } catch {
        // Ignore unreadable partial files
      }
    }

    const keepCount = Math.max(this.retentionCount, protectedShas.size);
    if (snapshotFiles.length <= keepCount) {
      return;
    }

    // Sort newest first; snapshots that a ref pointer targets are never pruned
    snapshotFiles.sort((a, b) => {
      const pa = protectedShas.has(a.commitSha);
      const pb = protectedShas.has(b.commitSha);
      if (pa !== pb) return pa ? -1 : 1;
      return b.createdAtMs - a.createdAtMs;
    });

    const toDelete = snapshotFiles.slice(keepCount);
    for (const item of toDelete) {
      try {
        await fs.unlink(item.fullPath);
      } catch {
        // Ignore already-deleted file
      }
    }
  }

  async getLatestPointer(
    projectId: ProjectId | string,
  ): Promise<LatestIndexPointer | undefined> {
    await this.writeQueue;
    try {
      const raw = await fs.readFile(this.latestPointerPath(projectId), "utf8");
      return JSON.parse(raw) as LatestIndexPointer;
    } catch {
      return undefined;
    }
  }

  async getRefPointer(
    projectId: ProjectId | string,
    ref: string,
  ): Promise<LatestIndexPointer | undefined> {
    await this.writeQueue;
    return (await this.readRefs(projectId))[ref];
  }

  /** Latest snapshot indexed for exactly this ref (branch/tag), if any. */
  async getSnapshotForRef(
    projectId: ProjectId | string,
    ref: string,
  ): Promise<ProjectIndexSnapshot | undefined> {
    const pointer = await this.getRefPointer(projectId, ref);
    if (!pointer) return undefined;
    return this.getSnapshot(projectId, pointer.commitSha);
  }

  async getSnapshot(
    projectId: ProjectId | string,
    commitSha: string,
  ): Promise<ProjectIndexSnapshot | undefined> {
    await this.writeQueue;
    try {
      const raw = await fs.readFile(
        this.snapshotPath(projectId, commitSha),
        "utf8",
      );
      return JSON.parse(raw) as ProjectIndexSnapshot;
    } catch {
      return undefined;
    }
  }

  async getLatestSnapshot(
    projectId: ProjectId | string,
  ): Promise<ProjectIndexSnapshot | undefined> {
    const pointer = await this.getLatestPointer(projectId);
    if (!pointer) return undefined;
    return this.getSnapshot(projectId, pointer.commitSha);
  }

  async listSnapshotCommitShas(
    projectId: ProjectId | string,
  ): Promise<readonly string[]> {
    await this.writeQueue;
    const dir = this.projectDir(projectId);
    try {
      const entries = await fs.readdir(dir);
      const reservedNames = RESERVED_FILES;
      return entries
        .filter(
          (name) =>
            name.endsWith(".json") &&
            !reservedNames.has(name) &&
            !name.startsWith("profile.") &&
            !name.startsWith("embeddings.") &&
            !name.includes(".tmp."),
        )
        .map((name) => name.slice(0, -5))
        .sort();
    } catch {
      return [];
    }
  }

  async saveJob(job: IndexJob): Promise<void> {
    await this.enqueueWrite(async () => {
      await this.atomicWriteJson(this.jobFilePath(job.projectId), job);
    });
  }

  /** Records a finished job; replaces an entry with the same id, keeps the newest 50. */
  async appendHistory(entry: IndexHistoryEntry): Promise<void> {
    await this.enqueueWrite(async () => {
      const file = path.join(this.projectDir(entry.projectId), "history.json");
      let current: IndexHistoryEntry[] = [];
      try {
        current = JSON.parse(await fs.readFile(file, "utf8")) as IndexHistoryEntry[];
      } catch {
        // no history yet
      }
      const next = [entry, ...current.filter((e) => e.id !== entry.id)].slice(
        0,
        MAX_HISTORY_ENTRIES,
      );
      await this.atomicWriteJson(file, next);
    });
  }

  async getHistory(
    projectId: ProjectId | string,
    limit = MAX_HISTORY_ENTRIES,
  ): Promise<readonly IndexHistoryEntry[]> {
    await this.writeQueue;
    try {
      const raw = await fs.readFile(
        path.join(this.projectDir(projectId), "history.json"),
        "utf8",
      );
      return (JSON.parse(raw) as IndexHistoryEntry[]).slice(0, Math.max(1, limit));
    } catch {
      return [];
    }
  }

  async getJob(projectId: ProjectId | string): Promise<IndexJob | undefined> {
    await this.writeQueue;
    try {
      const raw = await fs.readFile(this.jobFilePath(projectId), "utf8");
      return JSON.parse(raw) as IndexJob;
    } catch {
      return undefined;
    }
  }

  async deleteProjectIndex(projectId: ProjectId | string): Promise<void> {
    await this.enqueueWrite(async () => {
      const dir = this.projectDir(projectId);
      try {
        await fs.rm(dir, { recursive: true, force: true });
      } catch {
        // Ignore if directory does not exist
      }
    });
  }
}
