/**
 * Persistent Project Store
 *
 * Stores and manages first-class Project entities, associated Merge Requests,
 * and review history records with persistence in `./.data/projects.json`.
 *
 * Guarantees:
 *  - Strict repository-based identity: `${gitHost.toLowerCase()}/${repositoryPath.toLowerCase()}`
 *  - Duplicate prevention: Rejects creating projects for already-registered repositories.
 *  - Automatic resolution: Finds or creates projects from any valid MR/PR or repository URL.
 *  - Crash safety: Atomic writes via temporary files.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type {
  Project,
  ProjectId,
  ProjectMergeRequest,
  ProjectReviewRecord,
  ProjectDeveloper,
  MergeRequestAuthor,
  MergeRequestGrade,
  MergeRequestAiUsage,
  ProjectWithStats,
  IsoTimestamp,
  RuleSuppression,
} from "@ai-review/core";
import {
  extractRepositoryIdentity,
  extractMergeRequestNumber,
} from "@ai-review/git";
import { suggestGrade } from "./grading.js";

export interface FeedbackRecord {
  readonly id: string;
  readonly projectId: string;
  readonly timestamp: number;
  readonly verdict: "up" | "down";
  readonly reason: string;
  readonly note?: string | undefined;
  readonly title: string;
  readonly category: string;
  readonly severity: string;
  readonly file: string;
  readonly ruleAdded: boolean;
  readonly author?: string | undefined;
}

function sameSuppression(a: RuleSuppression, b: RuleSuppression): boolean {
  return a.ruleId === b.ruleId && (a.file ?? "") === (b.file ?? "");
}

const RULES_HEADING = "Learned from reviewer feedback:";

const hashText = (text: string): string => createHash("sha256").update(text).digest("hex");

/** The instructions to send to reviewers: the compact version while it still matches the full text. */
export function instructionsForPrompt(
  project: Pick<Project, "customInstructions" | "compactInstructions" | "compactSourceHash"> | undefined,
): string | undefined {
  if (!project?.customInstructions) return undefined;
  if (
    project.compactInstructions &&
    project.compactSourceHash === hashText(project.customInstructions)
  ) {
    return project.compactInstructions;
  }
  return project.customInstructions;
}
const MAX_FEEDBACK = 200;

interface StorageData {
  feedback?: Record<string, FeedbackRecord[]>; // projectId -> feedback list
  projects: Record<string, Project>;
  identityIndex: Record<string, string>; // identityKey -> projectId
  mergeRequests: Record<string, ProjectMergeRequest[]>; // projectId -> MR list
  reviews: Record<string, ProjectReviewRecord[]>; // projectId -> review list
  developers?: Record<string, ProjectDeveloper>; // `${host}/${username}` -> developer
  /** 10 once MR grades use the 0-10 scale (older files used 0-100). */
  gradeScale?: number;
}

export class ProjectStore {
  private readonly filePath: string;
  private readonly dirPath: string;
  private data: StorageData = {
    projects: {},
    identityIndex: {},
    mergeRequests: {},
    reviews: {},
    gradeScale: 10,
  };
  private loaded = false;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(storageDir = "./.data") {
    this.dirPath = path.resolve(storageDir);
    this.filePath = path.join(this.dirPath, "projects.json");
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      await fs.mkdir(this.dirPath, { recursive: true });
      const raw = await fs.readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw);
      this.data = {
        projects: parsed.projects || {},
        identityIndex: parsed.identityIndex || {},
        mergeRequests: parsed.mergeRequests || {},
        reviews: parsed.reviews || {},
        feedback: parsed.feedback || {},
        developers: parsed.developers || {},
      };
      if (parsed.gradeScale !== 10) {
        // One-time migration of MR grades from the old 0-100 scale to 0-10.
        for (const mrs of Object.values(this.data.mergeRequests)) {
          mrs.forEach((m, i) => {
            const grade = m.grade && { ...m.grade, score: Math.round(m.grade.score / 10) };
            const suggestedGrade = m.suggestedGrade && {
              ...m.suggestedGrade,
              score: Math.max(1, Math.round(m.suggestedGrade.score / 10)),
            };
            mrs[i] = { ...m, ...(grade ? { grade } : {}), ...(suggestedGrade ? { suggestedGrade } : {}) };
          });
        }
      }
      this.data.gradeScale = 10;
      // Rebuild identityIndex if missing or corrupted
      for (const p of Object.values(this.data.projects)) {
        const key = `${p.gitHost.toLowerCase()}/${p.repositoryPath.toLowerCase()}`;
        this.data.identityIndex[key] = p.id;
      }
    } catch {
      // File not found or empty, initialize clean store
      this.data = {
        projects: {},
        identityIndex: {},
        mergeRequests: {},
        reviews: {},
      };
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.mkdir(this.dirPath, { recursive: true });
      const tmpPath = `${this.filePath}.tmp.${Date.now()}`;
      await fs.writeFile(tmpPath, JSON.stringify(this.data, null, 2), "utf-8");
      await fs.rename(tmpPath, this.filePath);
    });
    return this.writeQueue;
  }

  async listProjects(): Promise<ProjectWithStats[]> {
    await this.ensureLoaded();
    const projects = Object.values(this.data.projects);

    const result: ProjectWithStats[] = projects.map((p) => {
      const mrs = this.data.mergeRequests[p.id] || [];
      const revs = this.data.reviews[p.id] || [];

      let latestReview: ProjectReviewRecord | undefined = undefined;
      let totalScore = 0;
      let scoreCount = 0;

      for (const r of revs) {
        if (!latestReview || r.timestamp > latestReview.timestamp) {
          latestReview = r;
        }
        if (r.score !== undefined) {
          totalScore += r.score;
          scoreCount++;
        }
      }

      return {
        ...p,
        mergeRequestCount: mrs.length,
        reviewCount: revs.length,
        latestReview: latestReview || undefined,
        averageScore:
          scoreCount > 0 ? Math.round(totalScore / scoreCount) : undefined,
      };
    });

    // Sort by latest update or creation descending
    result.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    return result;
  }

  async getProject(id: string): Promise<
    | {
        project: Project;
        mergeRequests: ProjectMergeRequest[];
        reviews: ProjectReviewRecord[];
        stats: {
          mergeRequestCount: number;
          reviewCount: number;
          averageScore?: number | undefined;
          latestReview?: ProjectReviewRecord | undefined;
        };
      }
    | undefined
  > {
    await this.ensureLoaded();
    const project = this.data.projects[id];
    if (!project) return undefined;

    const mergeRequests = [...(this.data.mergeRequests[id] || [])].sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    const reviews = [...(this.data.reviews[id] || [])].sort(
      (a, b) => b.timestamp - a.timestamp,
    );

    let totalScore = 0;
    let scoreCount = 0;
    for (const r of reviews) {
      if (r.score !== undefined) {
        totalScore += r.score;
        scoreCount++;
      }
    }

    return {
      project,
      mergeRequests,
      reviews,
      stats: {
        mergeRequestCount: mergeRequests.length,
        reviewCount: reviews.length,
        averageScore:
          scoreCount > 0 ? Math.round(totalScore / scoreCount) : undefined,
        latestReview: reviews[0] || undefined,
      },
    };
  }

  async findProjectByIdentity(
    gitHost: string,
    repositoryPath: string,
  ): Promise<Project | undefined> {
    await this.ensureLoaded();
    const key = `${gitHost.toLowerCase()}/${repositoryPath.toLowerCase().replace(/^\/+|\/+$/g, "")}`;
    const id = this.data.identityIndex[key];
    if (!id) return undefined;
    return this.data.projects[id];
  }

  async createProject(input: {
    name?: string | undefined;
    repositoryUrl: string;
    description?: string | undefined;
    customInstructions?: string | undefined;
  }): Promise<Project> {
    await this.ensureLoaded();

    if (!input.repositoryUrl || typeof input.repositoryUrl !== "string") {
      throw new Error("Repository URL is required");
    }

    const identity = extractRepositoryIdentity(input.repositoryUrl);
    if (!identity) {
      throw new Error(
        "Invalid repository URL format. Please provide a valid Git repository URL.",
      );
    }

    // Duplicate check: check identityKey
    const existingId = this.data.identityIndex[identity.identityKey];
    if (existingId && this.data.projects[existingId]) {
      const existing = this.data.projects[existingId];
      const err = new Error(
        `A project for repository "${identity.gitHost}/${identity.repositoryPath}" already exists (Name: "${existing.name}").`,
      );
      (err as any).code = "DUPLICATE_PROJECT";
      (err as any).existingProject = existing;
      throw err;
    }

    const now = new Date().toISOString() as IsoTimestamp;
    const projectId =
      `proj_${Date.now()}_${Math.random().toString(36).substring(2, 7)}` as ProjectId;
    const name = input.name?.trim() ? input.name.trim() : identity.name;

    const project: Project = {
      id: projectId,
      name,
      repositoryUrl: identity.repositoryUrl,
      gitHost: identity.gitHost,
      repositoryPath: identity.repositoryPath,
      namespace: identity.namespace,
      description: input.description?.trim() || undefined,
      customInstructions: input.customInstructions?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };

    this.data.projects[projectId] = project;
    this.data.identityIndex[identity.identityKey] = projectId;
    this.data.mergeRequests[projectId] = [];
    this.data.reviews[projectId] = [];

    await this.persist();
    return project;
  }

  async updateProject(
    id: string,
    patch: {
      name?: string | undefined;
      description?: string | undefined;
      customInstructions?: string | undefined;
      compactInstructions?: string | undefined;
    },
  ): Promise<Project> {
    await this.ensureLoaded();
    const existing = this.data.projects[id];
    if (!existing) {
      throw new Error(`Project with ID "${id}" not found`);
    }

    const now = new Date().toISOString() as IsoTimestamp;
    const customInstructions =
      patch.customInstructions !== undefined
        ? patch.customInstructions.trim() || undefined
        : existing.customInstructions;
    const textChanged = customInstructions !== existing.customInstructions;
    // A compact version is only valid for the exact text it was made from.
    let compact = textChanged ? undefined : existing.compactInstructions;
    if (patch.compactInstructions !== undefined) compact = patch.compactInstructions.trim() || undefined;
    const compactFields =
      customInstructions && compact
        ? { compactInstructions: compact, compactSourceHash: hashText(customInstructions) }
        : { compactInstructions: undefined, compactSourceHash: undefined };
    const updated: Project = {
      ...existing,
      ...compactFields,
      name:
        patch.name !== undefined
          ? patch.name.trim() || existing.name
          : existing.name,
      description:
        patch.description !== undefined
          ? patch.description.trim() || undefined
          : existing.description,
      customInstructions,
      updatedAt: now,
    };

    this.data.projects[id] = updated;
    await this.persist();
    return updated;
  }

  /**
   * Stores one piece of reviewer feedback. When `rule` is given it is appended
   * to the project's custom instructions (the "project rules" the AI reads on
   * every review), once, under a dedicated heading.
   */
  async addFeedback(
    projectId: string,
    input: Omit<FeedbackRecord, "id" | "projectId" | "timestamp" | "ruleAdded">,
    rule?: string,
    suppression?: RuleSuppression,
  ): Promise<{ record: FeedbackRecord; project: Project }> {
    await this.ensureLoaded();
    const project = this.data.projects[projectId];
    if (!project) throw new Error(`Project with ID "${projectId}" not found`);

    let updated = project;
    if (suppression) {
      const existing = project.suppressedRules ?? [];
      if (!existing.some((s) => sameSuppression(s, suppression))) {
        updated = {
          ...project,
          suppressedRules: [
            ...existing,
            {
              ruleId: suppression.ruleId,
              ...(suppression.file ? { file: suppression.file } : {}),
            },
          ],
          updatedAt: new Date().toISOString() as IsoTimestamp,
        };
        this.data.projects[projectId] = updated;
      }
    }
    const cleanRule = rule?.replace(/\s+/g, " ").trim();
    if (cleanRule) {
      const current = project.customInstructions ?? "";
      const line = `- ${cleanRule}`;
      if (!current.split("\n").some((l) => l.trim() === line)) {
        const body = current.includes(RULES_HEADING)
          ? `${current.trimEnd()}\n${line}`
          : `${current.trimEnd()}${current.trim() ? "\n\n" : ""}${RULES_HEADING}\n${line}`;
        // Keep a still-valid compact version in step with the new rule.
        const compactValid =
          project.compactInstructions &&
          project.compactSourceHash === hashText(current);
        updated = {
          ...updated,
          customInstructions: body,
          ...(compactValid
            ? {
                compactInstructions: `${project.compactInstructions!.trimEnd()}\n${line}`,
                compactSourceHash: hashText(body),
              }
            : {}),
          updatedAt: new Date().toISOString() as IsoTimestamp,
        };
        this.data.projects[projectId] = updated;
      }
    }

    const record: FeedbackRecord = {
      ...input,
      id: `fb_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      projectId,
      timestamp: Date.now(),
      ruleAdded: Boolean(cleanRule) || Boolean(suppression),
    };
    const list = (this.data.feedback ??= {})[projectId] ?? [];
    list.unshift(record);
    if (list.length > MAX_FEEDBACK) list.length = MAX_FEEDBACK;
    this.data.feedback[projectId] = list;
    await this.persist();
    return { record, project: updated };
  }

  /**
   * Re-enables a silenced rule. Matches the exact entry: without `file` only the
   * project-wide one is removed. Returns the project (unchanged if no match).
   */
  async removeRuleSuppression(
    projectId: string,
    ruleId: string,
    file?: string,
  ): Promise<Project> {
    await this.ensureLoaded();
    const project = this.data.projects[projectId];
    if (!project) throw new Error(`Project with ID "${projectId}" not found`);
    const target: RuleSuppression = { ruleId, ...(file ? { file } : {}) };
    const existing = project.suppressedRules ?? [];
    const kept = existing.filter((s) => !sameSuppression(s, target));
    if (kept.length === existing.length) return project;
    const { suppressedRules: _drop, ...rest } = project;
    const updated: Project = {
      ...rest,
      ...(kept.length > 0 ? { suppressedRules: kept } : {}),
      updatedAt: new Date().toISOString() as IsoTimestamp,
    };
    this.data.projects[projectId] = updated;
    await this.persist();
    return updated;
  }

  /**
   * Stores the per-project review configuration. Each given field replaces the
   * stored value; an empty value removes the field, so projects without any
   * configuration keep the exact shape they had before.
   */
  async setReviewConfig(
    projectId: string,
    patch: {
      disabledAgents?: readonly string[];
      agentInstructions?: Readonly<Record<string, string>>;
      suppressedRules?: readonly RuleSuppression[];
    },
  ): Promise<Project> {
    await this.ensureLoaded();
    const project = this.data.projects[projectId];
    if (!project) throw new Error(`Project with ID "${projectId}" not found`);
    const {
      disabledAgents: _a,
      agentInstructions: _i,
      suppressedRules: _s,
      ...rest
    } = project;
    const disabledAgents = patch.disabledAgents ?? project.disabledAgents ?? [];
    const agentInstructions = patch.agentInstructions ?? project.agentInstructions ?? {};
    const suppressedRules = patch.suppressedRules ?? project.suppressedRules ?? [];
    const updated: Project = {
      ...rest,
      ...(disabledAgents.length > 0 ? { disabledAgents: [...disabledAgents] } : {}),
      ...(Object.keys(agentInstructions).length > 0 ? { agentInstructions: { ...agentInstructions } } : {}),
      ...(suppressedRules.length > 0 ? { suppressedRules: [...suppressedRules] } : {}),
      updatedAt: new Date().toISOString() as IsoTimestamp,
    };
    this.data.projects[projectId] = updated;
    await this.persist();
    return updated;
  }

  /**
   * Short text of the most recent rejected findings that were NOT promoted to
   * rules, for the review prompt. Keeps recent feedback in play without
   * touching the project's permanent instructions.
   *
   * Sent to reviewers as `rejectedFeedback`, rendered by the specialist prompt
   * builder as an `untrustedBlock("rejected_feedback", ...)` in the final
   * `<review_task>` message only. The titles and reasons come from model output
   * on merge requests, so it is untrusted: never put it in customInstructions
   * or `<project_guidelines>`.
   */
  async getFeedbackDigest(projectId: string, limit = 5): Promise<string> {
    await this.ensureLoaded();
    const items = (this.data.feedback?.[projectId] ?? [])
      .filter((f) => f.verdict === "down" && !f.ruleAdded)
      .slice(0, limit);
    if (items.length === 0) return "";
    return [
      "Recent reviewer feedback (findings reviewers rejected; avoid repeating similar ones):",
      ...items.map(
        (f) =>
          `- [${f.category}] "${f.title}" in ${f.file}: ${f.reason.slice(0, 160)}${f.note ? ` — ${f.note.slice(0, 120)}` : ""}`,
      ),
    ].join("\n");
  }

  /**
   * Automatically finds an existing project or creates a new one from an MR/PR URL or repository URL.
   * If the input is an MR/PR URL, it also associates or records the Merge Request.
   */
  async findOrCreateFromUrl(
    url: string,
    defaultName?: string,
  ): Promise<{
    project: Project;
    mergeRequest?: ProjectMergeRequest | undefined;
    created: boolean;
  }> {
    await this.ensureLoaded();

    const identity = extractRepositoryIdentity(url);
    if (!identity) {
      throw new Error("Could not extract repository identity from URL");
    }

    let created = false;
    let project: Project;
    const existingId = this.data.identityIndex[identity.identityKey];

    if (existingId && this.data.projects[existingId]) {
      project = this.data.projects[existingId];
    } else {
      const now = new Date().toISOString() as IsoTimestamp;
      const projectId =
        `proj_${Date.now()}_${Math.random().toString(36).substring(2, 7)}` as ProjectId;
      const name = defaultName?.trim() ? defaultName.trim() : identity.name;

      project = {
        id: projectId,
        name,
        repositoryUrl: identity.repositoryUrl,
        gitHost: identity.gitHost,
        repositoryPath: identity.repositoryPath,
        namespace: identity.namespace,
        createdAt: now,
        updatedAt: now,
      };

      this.data.projects[projectId] = project;
      this.data.identityIndex[identity.identityKey] = projectId;
      this.data.mergeRequests[projectId] = [];
      this.data.reviews[projectId] = [];
      created = true;
    }

    // Check if this URL contains an MR / PR number
    let mergeRequest: ProjectMergeRequest | undefined = undefined;
    const mrNumber = extractMergeRequestNumber(url);

    if (mrNumber) {
      const mrs = this.data.mergeRequests[project.id] || [];
      const existingMr = mrs.find((m) => m.mrNumber === mrNumber);

      if (existingMr) {
        mergeRequest = existingMr;
      } else {
        const now = new Date().toISOString() as IsoTimestamp;
        mergeRequest = {
          id: `mr_${project.id}_${mrNumber}`,
          projectId: project.id,
          mrNumber,
          url: url.trim(),
          createdAt: now,
          updatedAt: now,
        };
        mrs.unshift(mergeRequest);
        this.data.mergeRequests[project.id] = mrs;
      }

      // Update project updatedAt timestamp
      this.data.projects[project.id] = {
        ...project,
        updatedAt: new Date().toISOString() as IsoTimestamp,
      };
    }

    await this.persist();
    return { project, mergeRequest: mergeRequest || undefined, created };
  }

  async recordReview(params: {
    projectId: string;
    mergeRequestId?: string | undefined;
    reviewId?: string | undefined;
    model?: string | undefined;
    target: string;
    inputMode?: string | undefined;
    result: any;
    score?: number | undefined;
  }): Promise<ProjectReviewRecord> {
    await this.ensureLoaded();
    const project = this.data.projects[params.projectId];
    if (!project) {
      throw new Error(`Project "${params.projectId}" not found`);
    }

    const issues = Array.isArray(params.result?.issues)
      ? params.result.issues
      : [];
    const acceptedCount =
      typeof params.result?.accepted === "number"
        ? params.result.accepted
        : issues.filter((i: any) => i.accepted).length;

    let criticalCount = 0;
    let highCount = 0;
    for (const issue of issues) {
      if (issue.severity === "critical") criticalCount++;
      else if (issue.severity === "high") highCount++;
    }

    // Calculate score 0-100: starts at 100, deducted by severity
    let score = params.score;
    if (score === undefined) {
      let deductions = 0;
      for (const i of issues) {
        if (!i.accepted) continue;
        if (i.severity === "critical") deductions += 25;
        else if (i.severity === "high") deductions += 15;
        else if (i.severity === "medium") deductions += 6;
        else if (i.severity === "low") deductions += 2;
      }
      score = Math.max(10, Math.min(100, 100 - deductions));
    }

    const record: ProjectReviewRecord = {
      id:
        params.reviewId ||
        `rev_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      projectId: project.id,
      mergeRequestId: params.mergeRequestId || undefined,
      timestamp: Date.now(),
      inputMode: params.inputMode || "pr",
      target: params.target,
      model: params.model || "Unknown",
      score,
      issuesCount: issues.length,
      acceptedCount,
      criticalCount,
      highCount,
      summaryMarkdown:
        typeof params.result?.markdown === "string"
          ? params.result.markdown.substring(0, 500)
          : undefined,
    };

    const projectReviews = this.data.reviews[project.id] ?? [];
    projectReviews.unshift(record);

    // Keep up to 100 review records per project
    if (projectReviews.length > 100) {
      projectReviews.length = 100;
    }
    this.data.reviews[project.id] = projectReviews;

    // Update project and MR timestamps
    const now = new Date().toISOString() as IsoTimestamp;
    this.data.projects[project.id] = {
      ...project,
      updatedAt: now,
    };

    if (params.mergeRequestId) {
      const mrs = this.data.mergeRequests[project.id] || [];
      const idx = mrs.findIndex((m) => m.id === params.mergeRequestId);
      const targetMr = mrs[idx];
      if (targetMr) {
        const suggestion = suggestGrade(issues);
        mrs[idx] = {
          ...targetMr,
          updatedAt: now,
          suggestedGrade: {
            score: suggestion.score,
            reason: suggestion.reason,
            reviewId: record.id,
            computedAt: now,
          },
        };
      }
    }

    await this.persist();
    return record;
  }

  /**
   * Stores title/branches/author fetched from the git provider on an MR and
   * registers the author in the developer registry (no login account is made).
   */
  async setMergeRequestMeta(
    projectId: string,
    mergeRequestId: string,
    meta: {
      title?: string | undefined;
      sourceBranch?: string | undefined;
      targetBranch?: string | undefined;
      author?: MergeRequestAuthor | undefined;
    },
    linkedUserId?: string | undefined,
  ): Promise<ProjectMergeRequest | undefined> {
    await this.ensureLoaded();
    const project = this.data.projects[projectId];
    const mrs = this.data.mergeRequests[projectId];
    const idx = mrs ? mrs.findIndex((m) => m.id === mergeRequestId) : -1;
    const mr = mrs?.[idx];
    if (!project || !mrs || !mr) return undefined;

    const updated: ProjectMergeRequest = {
      ...mr,
      title: meta.title || mr.title,
      sourceBranch: meta.sourceBranch || mr.sourceBranch,
      targetBranch: meta.targetBranch || mr.targetBranch,
      author: meta.author ?? mr.author,
    };
    mrs[idx] = updated;

    if (meta.author) {
      const devs = (this.data.developers ??= {});
      const id = `${project.gitHost}/${meta.author.username}`.toLowerCase();
      const existing = devs[id];
      devs[id] = {
        id,
        gitHost: project.gitHost,
        username: meta.author.username,
        name: meta.author.name ?? existing?.name,
        avatarUrl: meta.author.avatarUrl ?? existing?.avatarUrl,
        profileUrl: meta.author.profileUrl ?? existing?.profileUrl,
        linkedUserId: linkedUserId ?? existing?.linkedUserId,
        firstSeenAt: existing?.firstSeenAt ?? (new Date().toISOString() as IsoTimestamp),
      };
    }

    await this.persist();
    return updated;
  }

  /** Sets (or clears, when `grade` is null) the reviewer's grade on an MR. */
  async gradeMergeRequest(
    projectId: string,
    mergeRequestId: string,
    grade: MergeRequestGrade | null,
  ): Promise<ProjectMergeRequest | undefined> {
    await this.ensureLoaded();
    const mrs = this.data.mergeRequests[projectId];
    const idx = mrs ? mrs.findIndex((m) => m.id === mergeRequestId) : -1;
    const mr = mrs?.[idx];
    if (!mrs || !mr) return undefined;

    const { grade: _old, ...rest } = mr;
    const updated: ProjectMergeRequest = grade ? { ...rest, grade } : rest;
    mrs[idx] = {
      ...updated,
      updatedAt: new Date().toISOString() as IsoTimestamp,
    };
    await this.persist();
    return mrs[idx];
  }

  async setMergeRequestAiUsage(
    projectId: string,
    mergeRequestId: string,
    aiUsage: MergeRequestAiUsage,
  ): Promise<ProjectMergeRequest | undefined> {
    await this.ensureLoaded();
    const mrs = this.data.mergeRequests[projectId];
    const idx = mrs ? mrs.findIndex((m) => m.id === mergeRequestId) : -1;
    const mr = mrs?.[idx];
    if (!mrs || !mr) return undefined;
    mrs[idx] = { ...mr, aiUsage };
    await this.persist();
    return mrs[idx];
  }

  /** Developers who authored MRs in this project, with their grade summary. */
  async listDevelopers(projectId: string): Promise<
    {
      developer: ProjectDeveloper | { username: string };
      mergeRequestCount: number;
      gradedCount: number;
      averageGrade?: number | undefined;
    }[]
  > {
    await this.ensureLoaded();
    const project = this.data.projects[projectId];
    if (!project) return [];

    const byUser = new Map<string, { count: number; scores: number[]; username: string }>();
    for (const mr of this.data.mergeRequests[projectId] || []) {
      if (!mr.author) continue;
      const key = mr.author.username.toLowerCase();
      const entry = byUser.get(key) ?? { count: 0, scores: [], username: mr.author.username };
      entry.count++;
      if (mr.grade) entry.scores.push(mr.grade.score);
      byUser.set(key, entry);
    }

    return [...byUser.entries()]
      .map(([key, e]) => ({
        developer:
          this.data.developers?.[`${project.gitHost}/${key}`.toLowerCase()] ?? {
            username: e.username,
          },
        mergeRequestCount: e.count,
        gradedCount: e.scores.length,
        averageGrade: e.scores.length
          ? Math.round((e.scores.reduce((a, b) => a + b, 0) / e.scores.length) * 10) / 10
          : undefined,
      }))
      .sort((a, b) => b.mergeRequestCount - a.mergeRequestCount);
  }

  async deleteProject(id: string): Promise<boolean> {
    await this.ensureLoaded();
    const project = this.data.projects[id];
    if (!project) return false;

    const key = `${project.gitHost.toLowerCase()}/${project.repositoryPath.toLowerCase()}`;
    delete this.data.projects[id];
    delete this.data.identityIndex[key];
    delete this.data.mergeRequests[id];
    delete this.data.reviews[id];

    await this.persist();
    return true;
  }
}
