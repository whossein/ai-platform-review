/**
 * Repository rule scan (no AI): reads a branch of a remote repository through the
 * same sources as the project index, runs the deterministic rules over every text
 * file, and keeps the report (latest per branch) plus a short history.
 *
 * At most one active scan per project; cancellable; secret-bearing lines are never
 * stored in the report.
 */

import { randomBytes, createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Project } from "@ai-review/core";
import { enforceableSuppressions } from "./handlers/projects.js";
import {
  DEFAULT_RULES,
  DefaultRuleEngine,
  ruleLanguageFromEnv,
  MapRuleRegistry,
  ruleFindingToIssue,
  type FileRuleContext,
} from "@ai-review/orchestrator";
import {
  PathFilter,
  isBinaryContent,
  redactSecrets,
  type GitSourceCredentials,
  type IndexJobManager,
  type RepositorySource,
} from "@ai-review/project-index";

export type ScanSeverity = "critical" | "high" | "medium" | "low" | "info";

export interface ScanFinding {
  readonly ruleId: string;
  readonly category: string;
  readonly severity: ScanSeverity;
  readonly message: string;
  readonly file: string;
  readonly line: number;
  /** The offending line (trimmed); omitted for secret findings. */
  readonly snippet?: string | undefined;
}

export interface ScanSummary {
  readonly filesScanned: number;
  readonly filesSkipped: number;
  readonly totalFindings: number;
  readonly truncated: boolean;
  readonly bySeverity: Readonly<Record<ScanSeverity, number>>;
  readonly durationMs: number;
}

export interface ScanJob {
  readonly id: string;
  readonly projectId: string;
  readonly ref?: string | undefined;
  readonly commitSha?: string | undefined;
  readonly status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  readonly progress: { readonly done: number; readonly total: number; readonly message: string };
  readonly startedAt: string;
  readonly finishedAt?: string | undefined;
  readonly error?: string | undefined;
  readonly summary?: ScanSummary | undefined;
}

export interface ScanReport {
  readonly job: ScanJob;
  readonly summary: ScanSummary;
  readonly findings: readonly ScanFinding[];
}

export const MAX_SCAN_FILES = 3_000;
export const MAX_SCAN_FINDINGS = 5_000;
const MAX_SCAN_HISTORY = 50;
const READ_CONCURRENCY = 8;
const BATCH_SIZE = 200;
const SNIPPET_MAX = 200;

const SEVERITIES: readonly ScanSeverity[] = ["critical", "high", "medium", "low", "info"];
const SEVERITY_ORDER: Record<ScanSeverity, number> = {
  critical: 0, high: 1, medium: 2, low: 3, info: 4,
};

/** Rules meant for diffs (release-change governance) make no sense on a whole tree. */
const SCAN_RULES = DEFAULT_RULES.filter((r) => r.id !== "governance.require-release-change");

function seg(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export class ScanStore {
  private readonly baseDir: string;
  private queue: Promise<void> = Promise.resolve();

  constructor(baseDir = "./.data/scans") {
    this.baseDir = path.resolve(baseDir);
  }

  private dir(projectId: string): string {
    const dir = path.resolve(this.baseDir, seg(projectId));
    // seg() lets "." and ".." through; never resolve to baseDir or outside it.
    if (!dir.startsWith(this.baseDir + path.sep)) throw new Error("Invalid project id");
    return dir;
  }

  private refFile(projectId: string, ref: string): string {
    return path.join(this.dir(projectId), `ref-${createHash("sha1").update(ref).digest("hex").slice(0, 16)}.json`);
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async write(file: string, payload: unknown): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp.${Date.now()}.${randomBytes(4).toString("hex")}`;
    await fs.writeFile(tmp, JSON.stringify(payload), "utf8");
    await fs.rename(tmp, file);
  }

  private async read<T>(file: string): Promise<T | undefined> {
    try {
      return JSON.parse(await fs.readFile(file, "utf8")) as T;
    } catch {
      return undefined;
    }
  }

  saveJob(job: ScanJob): Promise<void> {
    return this.enqueue(() => this.write(path.join(this.dir(job.projectId), "job.json"), job));
  }

  getJob(projectId: string): Promise<ScanJob | undefined> {
    return this.read<ScanJob>(path.join(this.dir(projectId), "job.json"));
  }

  saveReport(report: ScanReport): Promise<void> {
    const { projectId, ref } = report.job;
    return this.enqueue(async () => {
      if (ref) await this.write(this.refFile(projectId, ref), report);
      await this.write(path.join(this.dir(projectId), "latest.json"), report);
      const history = (await this.read<ScanJob[]>(path.join(this.dir(projectId), "history.json"))) ?? [];
      await this.write(
        path.join(this.dir(projectId), "history.json"),
        [report.job, ...history].slice(0, MAX_SCAN_HISTORY),
      );
    });
  }

  appendHistory(job: ScanJob): Promise<void> {
    return this.enqueue(async () => {
      const file = path.join(this.dir(job.projectId), "history.json");
      const history = (await this.read<ScanJob[]>(file)) ?? [];
      await this.write(file, [job, ...history].slice(0, MAX_SCAN_HISTORY));
    });
  }

  getReport(projectId: string, ref?: string): Promise<ScanReport | undefined> {
    return this.read<ScanReport>(
      ref ? this.refFile(projectId, ref) : path.join(this.dir(projectId), "latest.json"),
    );
  }

  async getHistory(projectId: string): Promise<ScanJob[]> {
    return (await this.read<ScanJob[]>(path.join(this.dir(projectId), "history.json"))) ?? [];
  }

  deleteProject(projectId: string): Promise<void> {
    return fs.rm(this.dir(projectId), { recursive: true, force: true });
  }
}

export interface StartScanInput {
  readonly project: Project;
  readonly ref?: string | undefined;
  readonly credentials?: GitSourceCredentials | undefined;
  readonly sourceOverride?: RepositorySource | undefined;
}

interface Active {
  job: ScanJob;
  controller: AbortController;
  promise: Promise<ScanJob>;
}

export class ScanJobManager {
  private readonly active = new Map<string, Active>();

  constructor(
    private readonly store: ScanStore,
    private readonly indexJobs: IndexJobManager,
  ) {}

  async startJob(input: StartScanInput): Promise<ScanJob> {
    const key = String(input.project.id);
    const existing = this.active.get(key);
    if (existing && (existing.job.status === "queued" || existing.job.status === "running")) {
      return existing.job;
    }
    const job: ScanJob = {
      id: `scan_${Date.now()}_${randomBytes(4).toString("hex")}`,
      projectId: key,
      ...((input.ref ?? input.project.defaultBranch) !== undefined
        ? { ref: (input.ref ?? input.project.defaultBranch) as string }
        : {}),
      status: "queued",
      progress: { done: 0, total: 1, message: "Scan queued" },
      startedAt: new Date().toISOString(),
    };
    const handle: Active = {
      job,
      controller: new AbortController(),
      promise: Promise.resolve(job),
    };
    this.active.set(key, handle);
    await this.store.saveJob(job);
    handle.promise = this.run(handle, input);
    return handle.job;
  }

  async getJobStatus(projectId: string): Promise<ScanJob | undefined> {
    const active = this.active.get(projectId);
    if (active) return active.job;
    const persisted = await this.store.getJob(projectId);
    if (persisted && (persisted.status === "queued" || persisted.status === "running")) {
      const interrupted: ScanJob = {
        ...persisted,
        status: "failed",
        finishedAt: new Date().toISOString(),
        error: "Scan was interrupted by server restart",
      };
      await this.store.saveJob(interrupted);
      await this.store.appendHistory(interrupted);
      return interrupted;
    }
    return persisted;
  }

  cancelJob(projectId: string): boolean {
    const a = this.active.get(projectId);
    if (!a || (a.job.status !== "queued" && a.job.status !== "running")) return false;
    a.controller.abort();
    return true;
  }

  async waitForJob(projectId: string): Promise<ScanJob | undefined> {
    const a = this.active.get(projectId);
    return a ? a.promise : this.store.getJob(projectId);
  }

  private async run(handle: Active, input: StartScanInput): Promise<ScanJob> {
    const key = String(input.project.id);
    const signal = handle.controller.signal;
    const started = Date.now();
    const update = (patch: Partial<ScanJob>) => {
      if (signal.aborted) return;
      handle.job = { ...handle.job, ...patch };
      void this.store.saveJob(handle.job);
    };
    const abortCheck = () => {
      if (signal.aborted) {
        const err = new Error("Scan was cancelled");
        err.name = "AbortError";
        throw err;
      }
    };

    try {
      update({ status: "running", progress: { done: 0, total: 1, message: "Resolving branch" } });
      const source =
        input.sourceOverride ??
        this.indexJobs.createSourceForProject({
          project: input.project,
          credentials: input.credentials,
        });
      const resolved = await source.resolveRef(handle.job.ref, signal);
      abortCheck();
      update({ ref: resolved.ref, commitSha: resolved.commitSha });

      const tree = await source.listTree(resolved.commitSha, signal);
      abortCheck();
      const filter = new PathFilter({ maxFiles: MAX_SCAN_FILES });
      const candidates = tree.filter((e) => !filter.shouldExcludePath(e.path) && filter.isAllowedSize(e.size));
      const toScan = candidates.slice(0, MAX_SCAN_FILES);
      let skipped = tree.length - toScan.length;
      let truncated = candidates.length > MAX_SCAN_FILES;

      const registry = new MapRuleRegistry();
      for (const rule of SCAN_RULES) registry.register(rule);
      const engine = new DefaultRuleEngine(registry);

      const findings: ScanFinding[] = [];
      let scanned = 0;
      const total = toScan.length;
      update({ progress: { done: 0, total, message: `Scanning ${total} files` } });

      for (let b = 0; b < toScan.length; b += BATCH_SIZE) {
        const batch = toScan.slice(b, b + BATCH_SIZE);
        const files: { path: string; text: string }[] = [];
        let cursor = 0;
        const worker = async () => {
          while (cursor < batch.length) {
            const entry = batch[cursor++]!;
            abortCheck();
            try {
              const text = await source.readFile(entry, resolved.commitSha, signal);
              if (isBinaryContent(text)) skipped++;
              else files.push({ path: entry.path, text });
            } catch (err) {
              if (err instanceof Error && err.name === "AbortError") throw err;
              skipped++;
            }
          }
        };
        await Promise.all(Array.from({ length: READ_CONCURRENCY }, worker));
        abortCheck();

        const lineOf = new Map(files.map((f) => [f.path, f.text.split("\n")]));
        const ctx: FileRuleContext = {
          repositoryId: "repo.scan",
          files,
          language: ruleLanguageFromEnv(process.env),
        };
        const res = await engine.run(ctx);
        if (res.ok) {
          for (const f of res.value.findings) {
            // Rules a manager silenced via review feedback stay silent in scans too.
            if (
              enforceableSuppressions(input.project.suppressedRules).some(
                (s) => s.ruleId === f.ruleId && (!s.file || s.file === f.location.file),
              )
            ) {
              continue;
            }
            if (findings.length >= MAX_SCAN_FINDINGS) {
              truncated = true;
              break;
            }
            const issue = ruleFindingToIssue(f);
            const raw = lineOf.get(f.location.file)?.[(f.location.line ?? 1) - 1]?.trim();
            findings.push({
              ruleId: f.ruleId,
              category: issue.category,
              severity: f.severity as ScanSeverity,
              message: f.message,
              file: f.location.file,
              line: f.location.line ?? 1,
              ...(f.ruleKind !== "secret_detection" && raw
                ? { snippet: raw.slice(0, SNIPPET_MAX) }
                : {}),
            });
          }
        }
        scanned += files.length;
        update({ progress: { done: Math.min(b + batch.length, total), total, message: `Scanned ${scanned} files` } });
      }

      findings.sort(
        (a, b) =>
          SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
          (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line),
      );
      const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<ScanSeverity, number>;
      for (const f of findings) bySeverity[f.severity]++;
      const summary: ScanSummary = {
        filesScanned: scanned,
        filesSkipped: skipped,
        totalFindings: findings.length,
        truncated,
        bySeverity,
        durationMs: Date.now() - started,
      };
      const done: ScanJob = {
        ...handle.job,
        status: "succeeded",
        progress: { done: total, total, message: `Found ${findings.length} issue(s) in ${scanned} files` },
        finishedAt: new Date().toISOString(),
        summary,
      };
      handle.job = done;
      await this.store.saveJob(done);
      await this.store.saveReport({ job: done, summary, findings });
      return done;
    } catch (err) {
      const cancelled = signal.aborted || (err instanceof Error && err.name === "AbortError");
      const message = redactSecrets(
        err instanceof Error ? err.message : String(err ?? "Scan failed"),
        [input.credentials?.token],
      );
      const terminal: ScanJob = {
        ...handle.job,
        status: cancelled ? "cancelled" : "failed",
        progress: { ...handle.job.progress, message: cancelled ? "Scan cancelled" : message },
        finishedAt: new Date().toISOString(),
        ...(cancelled ? {} : { error: message }),
      };
      handle.job = terminal;
      await this.store.saveJob(terminal);
      await this.store.appendHistory(terminal);
      return terminal;
    } finally {
      if (this.active.get(key)?.job.id === handle.job.id) this.active.delete(key);
    }
  }
}
