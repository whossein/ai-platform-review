/**
 * Project Member & Team Access Route Handlers.
 */

import type {
  SafeUser,
  ProjectId,
  ProjectRole,
  ProjectMemberWithUser,
} from "@ai-review/core";
import type { SecurityContext } from "../security/security-context.js";

export async function listProjectMembersHandler(
  security: SecurityContext,
  projectId: ProjectId,
  currentUser: SafeUser
): Promise<ProjectMemberWithUser[]> {
  const allowed = await security.canAccessProject(
    currentUser,
    projectId,
    "project:view"
  );
  if (!allowed) {
    const err = new Error("Access denied: You do not have permission to view members of this project.");
    (err as any).status = 403;
    throw err;
  }

  const members = await security.memberStore.listProjectMembers(projectId);
  const result: ProjectMemberWithUser[] = [];

  for (const m of members) {
    const user = await security.userStore.getUserById(m.userId);
    if (user) {
      result.push({
        ...m,
        user,
      });
    }
  }

  return result;
}

export async function addProjectMemberHandler(
  security: SecurityContext,
  projectId: ProjectId,
  currentUser: SafeUser,
  body: any
) {
  const allowed = await security.canAccessProject(
    currentUser,
    projectId,
    "project:members"
  );
  if (!allowed) {
    const err = new Error("Access denied: You do not have permission to manage members of this project.");
    (err as any).status = 403;
    throw err;
  }

  const userId = body?.userId;
  const projectRole: ProjectRole = body?.projectRole || "VIEWER";

  if (!userId) {
    const err = new Error("userId is required.");
    (err as any).status = 400;
    throw err;
  }

  const targetUser = await security.userStore.getUserById(userId);
  if (!targetUser) {
    const err = new Error(`User "${userId}" not found.`);
    (err as any).status = 404;
    throw err;
  }

  const member = await security.memberStore.addMember(
    projectId,
    userId,
    projectRole
  );

  await security.auditStore.log({
    actorUserId: currentUser.id,
    actorName: currentUser.name,
    actorEmail: currentUser.email,
    action: "PROJECT_MEMBER_ADDED",
    entityType: "membership",
    entityId: member.id,
    metadata: {
      projectId,
      userId,
      projectRole,
    },
  });

  return {
    ...member,
    user: targetUser,
  };
}

export async function updateProjectMemberRoleHandler(
  security: SecurityContext,
  projectId: ProjectId,
  currentUser: SafeUser,
  targetUserId: string,
  body: any
) {
  const allowed = await security.canAccessProject(
    currentUser,
    projectId,
    "project:members"
  );
  if (!allowed) {
    const err = new Error("Access denied: You do not have permission to manage members of this project.");
    (err as any).status = 403;
    throw err;
  }

  const projectRole: ProjectRole = body?.projectRole;
  if (!projectRole) {
    const err = new Error("projectRole is required.");
    (err as any).status = 400;
    throw err;
  }

  const member = await security.memberStore.updateMemberRole(
    projectId,
    targetUserId,
    projectRole
  );

  await security.auditStore.log({
    actorUserId: currentUser.id,
    actorName: currentUser.name,
    actorEmail: currentUser.email,
    action: "PROJECT_MEMBER_UPDATED",
    entityType: "membership",
    entityId: member.id,
    metadata: {
      projectId,
      targetUserId,
      projectRole,
    },
  });

  return member;
}

export async function removeProjectMemberHandler(
  security: SecurityContext,
  projectId: ProjectId,
  currentUser: SafeUser,
  targetUserId: string
) {
  const allowed = await security.canAccessProject(
    currentUser,
    projectId,
    "project:members"
  );
  if (!allowed) {
    const err = new Error("Access denied: You do not have permission to manage members of this project.");
    (err as any).status = 403;
    throw err;
  }

  await security.memberStore.removeMember(projectId, targetUserId);

  await security.auditStore.log({
    actorUserId: currentUser.id,
    actorName: currentUser.name,
    actorEmail: currentUser.email,
    action: "PROJECT_MEMBER_REMOVED",
    entityType: "membership",
    entityId: `${projectId}:${targetUserId}`,
    metadata: {
      projectId,
      targetUserId,
    },
  });

  return { success: true };
}
