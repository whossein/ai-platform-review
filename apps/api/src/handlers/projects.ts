/**
 * Project Handlers
 *
 * REST endpoint handlers for the Project Registry & Management system,
 * integrated with Role-Based Access Control and user memberships.
 */

import type { ProjectStore } from "../project-store.js";
import type { SecurityContext } from "../security/security-context.js";
import type { SafeUser, ProjectId, IsoTimestamp, RuleSuppression } from "@ai-review/core";
import { fetchChangeRequestMeta, fetchChangeRequestCommitMessages, resolveDiffInput } from "@ai-review/git";
import { DEFAULT_RULES } from "@ai-review/orchestrator";
import { providersFromEnv } from "@ai-review/llm";
import { estimateAiUsage, type AiJudge } from "../ai-usage.js";
import { buildEffectiveEnv } from "./client-env.js";
import { optimizeInstructions } from "../instructions-optimizer.js";

export async function listProjectsHandler(
  projectStore: ProjectStore,
  security?: SecurityContext,
  currentUser?: SafeUser | null
) {
  const allProjects = await projectStore.listProjects();

  // With a security context, anonymous callers never see projects
  if (security && !currentUser) {
    return { projects: [] };
  }

  // If no security context or user is ADMIN, return all projects with role indication
  if (!security || !currentUser || currentUser.role === "ADMIN") {
    const enriched = await Promise.all(
      allProjects.map(async (p) => {
        let role = "OWNER";
        if (currentUser && security) {
          const memberRole = await security.memberStore.getUserProjectRole(p.id, currentUser.id);
          if (memberRole) role = memberRole;
          else if (currentUser.role === "ADMIN") role = "OWNER"; // Admin has owner rights
        }
        return {
          ...p,
          userRole: role,
        };
      })
    );
    return { projects: enriched };
  }

  // For regular members: find memberships
  const memberships = await security.memberStore.listUserMemberships(currentUser.id);
  const membershipMap = new Map(memberships.map((m) => [m.projectId, m.projectRole]));

  const filtered = allProjects
    .filter((p) => membershipMap.has(p.id))
    .map((p) => ({
      ...p,
      userRole: membershipMap.get(p.id) || "VIEWER",
    }));

  return { projects: filtered };
}

export async function getProjectDetailsHandler(
  projectStore: ProjectStore,
  id: string,
  security?: SecurityContext,
  currentUser?: SafeUser | null
) {
  if (security && currentUser) {
    const allowed = await security.canAccessProject(
      currentUser,
      id as ProjectId,
      "project:view"
    );
    if (!allowed) {
      const error = new Error("Access denied: You do not have permission to access this project.");
      (error as any).status = 403;
      throw error;
    }
  }

  const details = await projectStore.getProject(id);
  if (!details) {
    const error = new Error(`Project with ID "${id}" not found`);
    (error as any).status = 404;
    throw error;
  }

  let userRole: string | undefined = undefined;
  if (security && currentUser) {
    const r = await security.memberStore.getUserProjectRole(id as ProjectId, currentUser.id);
    userRole = r || (currentUser.role === "ADMIN" ? "OWNER" : undefined);
  }

  return {
    ...details,
    userRole,
  };
}

export async function createProjectHandler(
  projectStore: ProjectStore,
  body: {
    name?: string | undefined;
    repositoryUrl?: string | undefined;
    description?: string | undefined;
    customInstructions?: string | undefined;
  },
  security?: SecurityContext,
  creatorUser?: SafeUser | null
) {
  if (!body.repositoryUrl || typeof body.repositoryUrl !== "string") {
    const error = new Error("Field 'repositoryUrl' is required");
    (error as any).status = 400;
    throw error;
  }

  try {
    const project = await projectStore.createProject({
      name: body.name || undefined,
      repositoryUrl: body.repositoryUrl,
      description: body.description || undefined,
      customInstructions: body.customInstructions || undefined,
    });

    // Automatically make creator the OWNER in ProjectMemberStore
    if (security && creatorUser) {
      try {
        await security.memberStore.addMember(
          project.id as ProjectId,
          creatorUser.id,
          "OWNER"
        );
      } catch (memErr) {
        console.warn("Failed to auto-assign project creator as owner:", memErr);
      }

      await security.auditStore.log({
        actorUserId: creatorUser.id,
        actorName: creatorUser.name,
        actorEmail: creatorUser.email,
        action: "PROJECT_CREATED",
        entityType: "project",
        entityId: project.id,
        metadata: {
          name: project.name,
          repositoryUrl: project.repositoryUrl,
        },
      });
    }

    return { project, userRole: "OWNER" };
  } catch (err: any) {
    if (err.code === "DUPLICATE_PROJECT") {
      err.status = 409; // Conflict
    } else if (err.message.includes("Invalid")) {
      err.status = 400;
    }
    throw err;
  }
}

export async function updateProjectHandler(
  projectStore: ProjectStore,
  id: string,
  body: {
    name?: string | undefined;
    description?: string | undefined;
    customInstructions?: string | undefined;
    compactInstructions?: string | undefined;
  },
  security?: SecurityContext,
  currentUser?: SafeUser | null
) {
  if (security && currentUser) {
    const allowed = await security.canAccessProject(
      currentUser,
      id as ProjectId,
      "project:manage"
    );
    if (!allowed) {
      const error = new Error("Access denied: You do not have permission to manage this project.");
      (error as any).status = 403;
      throw error;
    }
  }

  const project = await projectStore.updateProject(id, {
    name: body.name,
    description: body.description,
    customInstructions: body.customInstructions,
    compactInstructions:
      typeof body.compactInstructions === "string" ? body.compactInstructions : undefined,
  });

  if (security && currentUser) {
    await security.auditStore.log({
      actorUserId: currentUser.id,
      actorName: currentUser.name,
      actorEmail: currentUser.email,
      action: "PROJECT_UPDATED",
      entityType: "project",
      entityId: id,
      metadata: { changed: Object.keys(body || {}) },
    });
  }

  return { project };
}

export async function findOrCreateProjectHandler(
  projectStore: ProjectStore,
  body: { url?: string | undefined; name?: string | undefined },
  security?: SecurityContext,
  currentUser?: SafeUser | null
) {
  if (!body.url || typeof body.url !== "string") {
    const error = new Error("Field 'url' is required");
    (error as any).status = 400;
    throw error;
  }

  const result = await projectStore.findOrCreateFromUrl(body.url, body.name || undefined);

  if (result.created && security && currentUser) {
    try {
      await security.memberStore.addMember(
        result.project.id as ProjectId,
        currentUser.id,
        "OWNER"
      );
    } catch {
      // Ignored if already added
    }

    await security.auditStore.log({
      actorUserId: currentUser.id,
      actorName: currentUser.name,
      actorEmail: currentUser.email,
      action: "PROJECT_CREATED",
      entityType: "project",
      entityId: result.project.id,
      metadata: { autoCreated: true, url: body.url },
    });
  }

  return result;
}

export async function recordReviewHandler(
  projectStore: ProjectStore,
  projectId: string,
  body: {
    mergeRequestId?: string | undefined;
    reviewId?: string | undefined;
    model?: string | undefined;
    target?: string | undefined;
    inputMode?: string | undefined;
    result?: any;
    score?: number | undefined;
  },
  security?: SecurityContext,
  currentUser?: SafeUser | null
) {
  if (security && currentUser) {
    const allowed = await security.canAccessProject(
      currentUser,
      projectId as ProjectId,
      "project:review"
    );
    if (!allowed) {
      const error = new Error("Access denied: You do not have permission to record reviews for this project.");
      (error as any).status = 403;
      throw error;
    }
  }

  const record = await projectStore.recordReview({
    projectId,
    mergeRequestId: body.mergeRequestId || undefined,
    reviewId: body.reviewId || undefined,
    model: body.model || undefined,
    target: body.target || "",
    inputMode: body.inputMode || undefined,
    result: body.result,
    score: body.score !== undefined ? body.score : undefined,
  });

  return { record };
}

export async function deleteProjectHandler(
  projectStore: ProjectStore,
  id: string,
  security?: SecurityContext,
  currentUser?: SafeUser | null
) {
  if (security && currentUser) {
    const allowed = await security.canAccessProject(
      currentUser,
      id as ProjectId,
      "project:delete"
    );
    if (!allowed) {
      const error = new Error("Access denied: Only project owners or system administrators can delete projects.");
      (error as any).status = 403;
      throw error;
    }
  }

  const success = await projectStore.deleteProject(id);
  if (!success) {
    const error = new Error(`Project with ID "${id}" not found`);
    (error as any).status = 404;
    throw error;
  }

  if (security && currentUser) {
    await security.auditStore.log({
      actorUserId: currentUser.id,
      actorName: currentUser.name,
      actorEmail: currentUser.email,
      action: "PROJECT_DELETED",
      entityType: "project",
      entityId: id,
    });
  }

  return { success: true };
}

/** Producer id of deterministic findings (RULE_ENGINE_AGENT in @ai-review/config). */
const RULE_ENGINE_PRODUCER = "agent.rule-engine";

/** Rules that may only be silenced per file; decided here, never by the request. */
const SECURITY_RULE_IDS: ReadonlySet<string> = new Set(
  DEFAULT_RULES.filter((r) =>
    ["security", "secret_detection", "sql_injection", "cors_misconfig"].includes(r.kind),
  ).map((r) => r.id),
);

/** Re-enables a rule a manager silenced via feedback. Manager-only. */
export async function removeSuppressedRuleHandler(
  projectStore: ProjectStore,
  projectId: string,
  body: { ruleId?: string; file?: string },
  security?: SecurityContext,
  currentUser?: SafeUser | null
) {
  const fail = (status: number, message: string) => {
    const error = new Error(message);
    (error as any).status = status;
    return error;
  };
  if (!body?.ruleId || typeof body.ruleId !== "string") throw fail(400, "Field 'ruleId' is required");
  if (security && currentUser) {
    const allowed = await security.canAccessProject(currentUser, projectId as ProjectId, "project:manage");
    if (!allowed) throw fail(403, "Access denied: You do not have permission to manage this project.");
  }
  let project;
  try {
    project = await projectStore.removeRuleSuppression(
      projectId,
      body.ruleId,
      typeof body.file === "string" && body.file ? body.file : undefined,
    );
  } catch (err: any) {
    throw fail(404, err.message);
  }
  if (security && currentUser) {
    await security.auditStore.log({
      actorUserId: currentUser.id,
      actorName: currentUser.name,
      actorEmail: currentUser.email,
      action: "PROJECT_UPDATED",
      entityType: "project",
      entityId: projectId,
      metadata: { unsuppressedRule: body.ruleId, ...(body.file ? { file: body.file } : {}) },
    });
  }
  return { project };
}

export async function submitFeedbackHandler(
  projectStore: ProjectStore,
  projectId: string,
  body: {
    verdict?: string;
    reason?: string;
    note?: string;
    rule?: string;
    addToRules?: boolean;
    issue?: {
      title?: string;
      category?: string;
      severity?: string;
      producedBy?: string;
      location?: { file?: string };
    };
  },
  security?: SecurityContext,
  currentUser?: SafeUser | null
) {
  const fail = (status: number, message: string) => {
    const error = new Error(message);
    (error as any).status = status;
    return error;
  };
  if (body.verdict !== "up" && body.verdict !== "down") {
    throw fail(400, "Field 'verdict' must be 'up' or 'down'");
  }
  if (!body.issue?.title) throw fail(400, "Field 'issue' is required");

  let canManage = true;
  if (security && currentUser) {
    const canReview = await security.canAccessProject(currentUser, projectId as ProjectId, "project:review");
    if (!canReview) throw fail(403, "Access denied: You do not have permission to give feedback on this project.");
    canManage = await security.canAccessProject(currentUser, projectId as ProjectId, "project:manage");
  }

  const wantsRule = body.addToRules === true && Boolean(body.rule?.trim());
  const fromRuleEngine = body.issue.producedBy === RULE_ENGINE_PRODUCER;
  const issueFile = body.issue.location?.file || "";

  // A rejected deterministic finding is silenced for real: appending text to the
  // AI guidelines would never stop the regex rule firing. Security rules are
  // always file-scoped so one false positive cannot disable secret or
  // prompt-injection detection for the whole project.
  let suppression: RuleSuppression | undefined;
  let suppressDenied: string | undefined;
  if (wantsRule && canManage && fromRuleEngine) {
    const security_ =
      body.issue.category === "security" || SECURITY_RULE_IDS.has(body.issue.title);
    if (security_ && !issueFile) {
      suppressDenied = "Feedback saved, but this security rule can only be silenced for a specific file.";
    } else {
      suppression = {
        ruleId: body.issue.title.slice(0, 200),
        ...(security_ ? { file: issueFile } : {}),
      };
    }
  }
  const rule = wantsRule && canManage && !fromRuleEngine ? body.rule!.slice(0, 500) : undefined;

  const { record, project } = await projectStore.addFeedback(
    projectId,
    {
      verdict: body.verdict,
      reason: (body.reason || (body.verdict === "up" ? "useful" : "other")).slice(0, 60),
      ...(body.note?.trim() ? { note: body.note.trim().slice(0, 500) } : {}),
      title: body.issue.title.slice(0, 200),
      category: body.issue.category || "unknown",
      severity: body.issue.severity || "unknown",
      file: body.issue.location?.file || "",
      ...(currentUser ? { author: currentUser.name } : {}),
    },
    rule,
    suppression,
  );

  if (suppression && security && currentUser) {
    await security.auditStore.log({
      actorUserId: currentUser.id,
      actorName: currentUser.name,
      actorEmail: currentUser.email,
      action: "PROJECT_UPDATED",
      entityType: "project",
      entityId: projectId,
      metadata: { suppressedRule: suppression.ruleId, ...(suppression.file ? { file: suppression.file } : {}) },
    });
  }

  return {
    record,
    project,
    ruleAdded: record.ruleAdded,
    ...(suppressDenied ? { ruleDenied: suppressDenied } : {}),
    ...(wantsRule && !canManage
      ? { ruleDenied: "Feedback saved, but only project managers can change the project rules." }
      : {}),
  };
}

/**
 * Fetches the MR author from the git provider, stores it on the MR, and
 * registers the author in the developer registry. Best effort: never throws.
 * If an app user's username/email prefix or name matches the git author, the
 * developer is linked to that user.
 */
export async function attachMergeRequestMeta(
  projectStore: ProjectStore,
  security: SecurityContext | undefined,
  projectId: string,
  mergeRequest: { id: string; url: string; author?: unknown } | undefined,
  env: Record<string, string | undefined>
): Promise<void> {
  if (!mergeRequest || mergeRequest.author) return;
  try {
    const meta = await fetchChangeRequestMeta(mergeRequest.url, env);
    if (!meta) {
      console.warn(`MR author lookup: no data for ${mergeRequest.url} (check the Git token and its read_api scope)`);
      return;
    }

    let linkedUserId: string | undefined;
    if (meta.author && security) {
      const uname = meta.author.username.toLowerCase();
      const dname = meta.author.name?.trim().toLowerCase();
      const users = await security.userStore.listUsers();
      linkedUserId = users.find(
        (u) =>
          u.email.split("@")[0]?.toLowerCase() === uname ||
          (dname !== undefined && u.name.trim().toLowerCase() === dname)
      )?.id;
    }
    await projectStore.setMergeRequestMeta(projectId, mergeRequest.id, meta, linkedUserId);
  } catch (e) {
    console.warn("MR author lookup notice:", e);
  }
}

export async function gradeMergeRequestHandler(
  projectStore: ProjectStore,
  projectId: string,
  mergeRequestId: string,
  body: { score?: unknown; note?: unknown },
  security: SecurityContext | undefined,
  currentUser: SafeUser | null | undefined
) {
  if (security && currentUser) {
    const allowed = await security.canAccessProject(currentUser, projectId as ProjectId, "project:review");
    if (!allowed) {
      const error = new Error("Access denied: Only reviewers and above can grade merge requests.");
      (error as any).status = 403;
      throw error;
    }
  }

  const score = body?.score;
  if (typeof score !== "number" || !Number.isInteger(score) || score < 0 || score > 10) {
    const error = new Error("score must be an integer between 0 and 10.");
    (error as any).status = 400;
    throw error;
  }
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 500) : "";

  const mergeRequest = await projectStore.gradeMergeRequest(projectId, mergeRequestId, {
    score,
    note: note || undefined,
    gradedById: currentUser?.id ?? "system",
    gradedByName: currentUser?.name ?? "system",
    gradedAt: new Date().toISOString() as IsoTimestamp,
  });
  if (!mergeRequest) {
    const error = new Error("Merge request not found.");
    (error as any).status = 404;
    throw error;
  }

  if (security && currentUser) {
    await security.auditStore.log({
      actorUserId: currentUser.id,
      actorName: currentUser.name,
      actorEmail: currentUser.email,
      action: "MR_GRADED",
      entityType: "project",
      entityId: projectId,
      metadata: { mergeRequestId, score, author: mergeRequest.author?.username },
    });
  }
  return { mergeRequest };
}

export async function clearMergeRequestGradeHandler(
  projectStore: ProjectStore,
  projectId: string,
  mergeRequestId: string,
  security: SecurityContext | undefined,
  currentUser: SafeUser | null | undefined
) {
  if (security && currentUser) {
    const allowed = await security.canAccessProject(currentUser, projectId as ProjectId, "project:review");
    if (!allowed) {
      const error = new Error("Access denied: Only reviewers and above can grade merge requests.");
      (error as any).status = 403;
      throw error;
    }
  }
  const mergeRequest = await projectStore.gradeMergeRequest(projectId, mergeRequestId, null);
  if (!mergeRequest) {
    const error = new Error("Merge request not found.");
    (error as any).status = 404;
    throw error;
  }
  return { mergeRequest };
}

export async function listProjectDevelopersHandler(
  projectStore: ProjectStore,
  projectId: string,
  security: SecurityContext | undefined,
  currentUser: SafeUser | null | undefined
) {
  if (security && currentUser) {
    const allowed = await security.canAccessProject(currentUser, projectId as ProjectId, "project:view");
    if (!allowed) {
      const error = new Error("Access denied: You do not have permission to access this project.");
      (error as any).status = 403;
      throw error;
    }
  }
  return { developers: await projectStore.listDevelopers(projectId) };
}

/**
 * Estimates how likely the MR was written with AI (rules + optional AI judge)
 * and stores the result on the MR. Independent of the review run.
 */
export async function estimateMergeRequestAiUsageHandler(
  projectStore: ProjectStore,
  projectId: string,
  mergeRequestId: string,
  env: Record<string, string>,
  security: SecurityContext | undefined,
  currentUser: SafeUser | null | undefined
) {
  if (security && currentUser) {
    const allowed = await security.canAccessProject(currentUser, projectId as ProjectId, "project:review");
    if (!allowed) {
      const error = new Error("Access denied: Only reviewers and above can run this estimate.");
      (error as any).status = 403;
      throw error;
    }
  }

  const details = await projectStore.getProject(projectId);
  const mr = details?.mergeRequests.find((m) => m.id === mergeRequestId);
  if (!mr) {
    const error = new Error("Merge request not found.");
    (error as any).status = 404;
    throw error;
  }

  const merged = buildEffectiveEnv(process.env, env, { targetUrl: mr.url });
  let diff: string;
  try {
    diff = await resolveDiffInput(mr.url, merged);
  } catch (e: any) {
    const error = new Error(`Could not load the MR diff: ${e.message}`);
    (error as any).status = 502;
    throw error;
  }
  const [meta, commitMessages] = await Promise.all([
    fetchChangeRequestMeta(mr.url, merged),
    fetchChangeRequestCommitMessages(mr.url, merged),
  ]);

  const provider = providersFromEnv(merged)[0];
  const judge: AiJudge | undefined =
    provider
      ? async ({ system, user }) => {
          const res = await provider.complete({
            model: provider.models()[0]!.id,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
            temperature: 0.1,
            maxTokens: 600,
          });
          if (res.ok === false) throw new Error(res.error.message || "AI request failed");
          return res.value.content;
        }
      : undefined;

  const result = await estimateAiUsage(
    {
      title: meta?.title ?? mr.title,
      description: meta?.description,
      commitMessages,
      diff,
    },
    judge
  );

  const updated = await projectStore.setMergeRequestAiUsage(projectId, mergeRequestId, {
    percent: result.percent,
    level: result.level,
    reasons: result.reasons,
    method: result.method,
    rulesScore: result.rulesScore,
    aiScore: result.aiScore,
    computedAt: new Date().toISOString() as IsoTimestamp,
    computedByName: currentUser?.name ?? "system",
  });

  if (security && currentUser) {
    await security.auditStore.log({
      actorUserId: currentUser.id,
      actorName: currentUser.name,
      actorEmail: currentUser.email,
      action: "MR_AI_USAGE_ESTIMATED",
      entityType: "project",
      entityId: projectId,
      metadata: { mergeRequestId, percent: result.percent, method: result.method },
    });
  }
  return { mergeRequest: updated };
}

/** Rewrites a project's guidelines with the configured AI provider; nothing is saved here. */
export async function optimizeProjectInstructionsHandler(
  projectStore: ProjectStore,
  projectId: string,
  body: { text?: unknown; english?: unknown; env?: Record<string, string | undefined> },
  security?: SecurityContext,
  currentUser?: SafeUser | null
) {
  if (security && currentUser) {
    const allowed = await security.canAccessProject(currentUser, projectId as ProjectId, "project:manage");
    if (!allowed) {
      const error = new Error("Access denied: You do not have permission to manage this project.");
      (error as any).status = 403;
      throw error;
    }
  }
  const details = await projectStore.getProject(projectId);
  if (!details) {
    const error = new Error("Project not found.");
    (error as any).status = 404;
    throw error;
  }
  const text = typeof body.text === "string" && body.text.trim() ? body.text : details.project.customInstructions;
  if (!text?.trim()) {
    const error = new Error("There are no guidelines to optimize.");
    (error as any).status = 400;
    throw error;
  }

  const merged = buildEffectiveEnv(process.env, body.env);
  const provider = providersFromEnv(merged)[0];
  if (!provider) {
    const error = new Error("No AI provider is connected. Add an API key in Settings first.");
    (error as any).status = 400;
    throw error;
  }

  try {
    return await optimizeInstructions(text, async ({ system, user }) => {
      const res = await provider.complete({
        model: provider.models()[0]!.id,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.2,
        maxTokens: 4000,
      });
      if (res.ok === false) throw new Error(res.error.message || "AI request failed");
      return res.value.content;
    }, { english: body.english === true });
  } catch (e: any) {
    const error = new Error(e.message || "Failed to optimize guidelines");
    (error as any).status = 502;
    throw error;
  }
}
