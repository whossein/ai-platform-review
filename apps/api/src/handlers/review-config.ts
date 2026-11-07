/**
 * Review catalog and per-project review configuration.
 *
 * The catalog lists what a review really consists of: the AI specialists in
 * `SPECIALISTS` and the deterministic rules in `DEFAULT_RULES`. A project
 * manager can switch specialists and rules off and add guidance per specialist;
 * `updateReviewConfigHandler` validates and stores that. The server enforces the
 * security limits itself, whatever the client sends.
 */

import type { ProjectStore } from "../project-store.js";
import type { SecurityContext } from "../security/security-context.js";
import type { SafeUser, ProjectId, RuleSuppression } from "@ai-review/core";
import { SPECIALISTS } from "@ai-review/shared";
import { DEFAULT_RULES } from "@ai-review/orchestrator";
import { SECURITY_RULE_IDS } from "./projects.js";

/** Specialists that can never be switched off. */
export const LOCKED_AGENT_IDS: ReadonlySet<string> = new Set(["agent.security-reviewer"]);

/** Longest extra guidance accepted per specialist (characters, after trimming). */
export const MAX_AGENT_INSTRUCTION_LENGTH = 2000;

export interface CatalogAgent {
  id: string;
  name: string;
  goal: string;
  checklist: string;
  focus: string;
  /** True when the specialist cannot be switched off. */
  locked: boolean;
}

export interface CatalogRule {
  id: string;
  description: string;
  severity: string | null;
  /** Security rules can only be silenced for one file, never project-wide. */
  security: boolean;
}

export interface ReviewCatalog {
  agents: CatalogAgent[];
  rules: CatalogRule[];
  limits: { maxAgentInstructionLength: number };
}

export function reviewCatalogHandler(): ReviewCatalog {
  return {
    agents: SPECIALISTS.map((s) => ({
      id: s.id,
      name: s.name,
      goal: s.goal,
      checklist: s.checklist,
      focus: s.focus,
      locked: LOCKED_AGENT_IDS.has(s.id),
    })),
    rules: DEFAULT_RULES.map((r) => ({
      id: r.id,
      description: r.description ?? r.id,
      severity: r.severity ?? null,
      security: SECURITY_RULE_IDS.has(r.id),
    })),
    limits: { maxAgentInstructionLength: MAX_AGENT_INSTRUCTION_LENGTH },
  };
}

export interface ReviewConfigBody {
  /** Agent ids to switch off; replaces the stored list. */
  disabledAgents?: unknown;
  /** Guidance per agent id; replaces the stored map (empty text removes an entry). */
  agentInstructions?: unknown;
  /** Rule ids to switch off project-wide; replaces the project-wide entries of catalog rules. */
  disabledRules?: unknown;
}

const fail = (status: number, message: string) => {
  const error = new Error(message);
  (error as any).status = status;
  return error;
};

const AGENT_IDS: ReadonlySet<string> = new Set(SPECIALISTS.map((s) => s.id));
const RULE_IDS: ReadonlySet<string> = new Set(DEFAULT_RULES.map((r) => r.id));

function stringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw fail(400, `Field '${field}' must be an array of strings`);
  }
  return [...new Set(value as string[])];
}

/** Manager-only. Changes which specialists and rules run for a project, and their guidance. */
export async function updateReviewConfigHandler(
  projectStore: ProjectStore,
  projectId: string,
  body: ReviewConfigBody,
  security?: SecurityContext,
  currentUser?: SafeUser | null,
) {
  if (security && currentUser) {
    const allowed = await security.canAccessProject(currentUser, projectId as ProjectId, "project:manage");
    if (!allowed) throw fail(403, "Access denied: You do not have permission to manage this project.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw fail(400, "Request body must be an object");
  if (
    body.disabledAgents === undefined &&
    body.agentInstructions === undefined &&
    body.disabledRules === undefined
  ) {
    throw fail(400, "Provide 'disabledAgents', 'agentInstructions' or 'disabledRules'");
  }
  const existing = await projectStore.getProject(projectId);
  if (!existing) throw fail(404, `Project with ID "${projectId}" not found`);

  let disabledAgents: string[] | undefined;
  if (body.disabledAgents !== undefined) {
    disabledAgents = stringList(body.disabledAgents, "disabledAgents");
    const unknown = disabledAgents.filter((id) => !AGENT_IDS.has(id));
    if (unknown.length > 0) throw fail(400, `Unknown agent id: ${unknown.join(", ")}`);
    const locked = disabledAgents.filter((id) => LOCKED_AGENT_IDS.has(id));
    if (locked.length > 0) throw fail(400, `Agent cannot be disabled: ${locked.join(", ")}`);
  }

  let agentInstructions: Record<string, string> | undefined;
  if (body.agentInstructions !== undefined) {
    const raw = body.agentInstructions;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw fail(400, "Field 'agentInstructions' must be an object of agent id to text");
    }
    agentInstructions = {};
    for (const [id, text] of Object.entries(raw)) {
      if (!AGENT_IDS.has(id)) throw fail(400, `Unknown agent id: ${id}`);
      if (typeof text !== "string") throw fail(400, `Instructions for ${id} must be a string`);
      const clean = text.trim();
      if (clean.length > MAX_AGENT_INSTRUCTION_LENGTH) {
        throw fail(400, `Instructions for ${id} are too long (max ${MAX_AGENT_INSTRUCTION_LENGTH} characters)`);
      }
      if (clean) agentInstructions[id] = clean;
    }
  }

  let suppressedRules: RuleSuppression[] | undefined;
  if (body.disabledRules !== undefined) {
    const disabledRules = stringList(body.disabledRules, "disabledRules");
    const unknown = disabledRules.filter((id) => !RULE_IDS.has(id));
    if (unknown.length > 0) throw fail(400, `Unknown rule id: ${unknown.join(", ")}`);
    const security_ = disabledRules.filter((id) => SECURITY_RULE_IDS.has(id));
    if (security_.length > 0) {
      throw fail(400, `Security rules can only be silenced for a specific file, not project-wide: ${security_.join(", ")}`);
    }
    // File-scoped entries and entries for ids outside the catalog (e.g. governance
    // rules silenced through feedback) are not this endpoint's to change.
    const kept = (existing.project.suppressedRules ?? []).filter(
      (s) => s.file !== undefined || !RULE_IDS.has(s.ruleId),
    );
    suppressedRules = [...kept, ...disabledRules.map((ruleId) => ({ ruleId }))];
  }

  const project = await projectStore.setReviewConfig(projectId, {
    ...(disabledAgents ? { disabledAgents } : {}),
    ...(agentInstructions ? { agentInstructions } : {}),
    ...(suppressedRules ? { suppressedRules } : {}),
  });

  if (security && currentUser) {
    await security.auditStore.log({
      actorUserId: currentUser.id,
      actorName: currentUser.name,
      actorEmail: currentUser.email,
      action: "PROJECT_UPDATED",
      entityType: "project",
      entityId: projectId,
      metadata: {
        reviewConfig: [
          ...(disabledAgents ? ["disabledAgents"] : []),
          ...(agentInstructions ? ["agentInstructions"] : []),
          ...(suppressedRules ? ["disabledRules"] : []),
        ].join(","),
      },
    });
  }
  return { project };
}
