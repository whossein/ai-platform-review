/**
 * User Management Route Handlers (Admin).
 */

import type { SafeUser, UserRole, UserStatus } from "@ai-review/core";
import type { SecurityContext } from "../security/security-context.js";

export async function listUsersHandler(security: SecurityContext) {
  return security.userStore.listUsers();
}

export async function getUserHandler(security: SecurityContext, id: string) {
  const user = await security.userStore.getUserById(id);
  if (!user) {
    const err = new Error(`User "${id}" not found.`);
    (err as any).status = 404;
    throw err;
  }
  return user;
}

export async function createUserHandler(
  security: SecurityContext,
  adminUser: SafeUser,
  body: any
) {
  const created = await security.userStore.createUser({
    name: body?.name,
    email: body?.email,
    password: body?.password,
    role: body?.role,
    status: body?.status,
    avatar: body?.avatar,
  });

  await security.auditStore.log({
    actorUserId: adminUser.id,
    actorName: adminUser.name,
    actorEmail: adminUser.email,
    action: "USER_CREATED",
    entityType: "user",
    entityId: created.id,
    metadata: {
      createdEmail: created.email,
      role: created.role,
      status: created.status,
    },
  });

  return created;
}

export async function updateUserHandler(
  security: SecurityContext,
  adminUser: SafeUser,
  id: string,
  body: any
) {
  const updated = await security.userStore.updateUser(id, {
    name: body?.name,
    email: body?.email,
    avatar: body?.avatar,
  });

  await security.auditStore.log({
    actorUserId: adminUser.id,
    actorName: adminUser.name,
    actorEmail: adminUser.email,
    action: "USER_UPDATED",
    entityType: "user",
    entityId: id,
    metadata: { changed: Object.keys(body || {}) },
  });

  return updated;
}

export async function setUserStatusHandler(
  security: SecurityContext,
  adminUser: SafeUser,
  id: string,
  status: UserStatus
) {
  const updated = await security.userStore.setUserStatus(id, status);

  if (status === "DISABLED") {
    // Immediately revoke all active sessions for the disabled user
    await security.sessionStore.revokeAllUserSessions(id);
  }

  await security.auditStore.log({
    actorUserId: adminUser.id,
    actorName: adminUser.name,
    actorEmail: adminUser.email,
    action: "USER_STATUS_CHANGED",
    entityType: "user",
    entityId: id,
    metadata: { status },
  });

  return updated;
}

export async function setUserRoleHandler(
  security: SecurityContext,
  adminUser: SafeUser,
  id: string,
  role: UserRole
) {
  const updated = await security.userStore.setUserRole(id, role);

  await security.auditStore.log({
    actorUserId: adminUser.id,
    actorName: adminUser.name,
    actorEmail: adminUser.email,
    action: "USER_ROLE_CHANGED",
    entityType: "user",
    entityId: id,
    metadata: { role },
  });

  return updated;
}

export async function resetUserPasswordHandler(
  security: SecurityContext,
  adminUser: SafeUser,
  id: string,
  body: any
) {
  const newPassword = body?.newPassword || body?.password || "";
  await security.userStore.resetPassword(id, newPassword);

  // Revoke target user's existing sessions for safety
  await security.sessionStore.revokeAllUserSessions(id);

  await security.auditStore.log({
    actorUserId: adminUser.id,
    actorName: adminUser.name,
    actorEmail: adminUser.email,
    action: "PASSWORD_RESET",
    entityType: "user",
    entityId: id,
  });

  return { success: true };
}

export async function deleteUserHandler(
  security: SecurityContext,
  adminUser: SafeUser,
  id: string
) {
  await security.userStore.deleteUser(id);
  await security.sessionStore.revokeAllUserSessions(id);

  await security.auditStore.log({
    actorUserId: adminUser.id,
    actorName: adminUser.name,
    actorEmail: adminUser.email,
    action: "USER_DELETED",
    entityType: "user",
    entityId: id,
  });

  return { success: true };
}
