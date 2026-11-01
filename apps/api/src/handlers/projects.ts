/**
 * Project Handlers
 *
 * REST endpoint handlers for the Project Registry & Management system,
 * integrated with Role-Based Access Control and user memberships.
 */

import type { ProjectStore } from "../project-store.js";
import type { SecurityContext } from "../security/security-context.js";
import type { SafeUser, ProjectId } from "@ai-review/core";

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
