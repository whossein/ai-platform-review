/**
 * Authentication and Session Route Handlers.
 */

import type { SafeUser } from "@ai-review/core";
import type { SecurityContext } from "../security/security-context.js";
import { verifyPassword } from "../security/crypto-utils.js";

export async function getAuthStatusHandler(security: SecurityContext, req: any) {
  const isFirstRun = await security.userStore.isFirstRun();
  const auth = await security.authenticateRequest(req);

  return {
    initialized: !isFirstRun,
    authenticated: Boolean(auth),
    user: auth?.user || null,
  };
}

export async function setupFirstAdminHandler(
  security: SecurityContext,
  body: any,
  ip = "unknown"
) {
  const rateKey = `setup:${ip}`;
  const rateStatus = security.rateLimiter.isBlocked(rateKey);
  if (rateStatus.blocked) {
    const err = new Error(`Too many attempts. Please try again in ${rateStatus.retryAfterSeconds} seconds.`);
    (err as any).status = 429;
    throw err;
  }

  const name = (body?.name || "").trim();
  const email = (body?.email || "").trim();
  const password = body?.password || "";
  const passwordConfirmation = body?.passwordConfirmation || body?.confirmPassword || "";

  if (!email || !password) {
    const err = new Error("Email and password are required.");
    (err as any).status = 400;
    throw err;
  }

  if (password !== passwordConfirmation) {
    const err = new Error("Password and password confirmation do not match.");
    (err as any).status = 400;
    throw err;
  }

  try {
    const safeAdmin = await security.userStore.setupFirstAdmin({
      name,
      email,
      password,
    });

    const session = await security.sessionStore.createSession(safeAdmin.id, {
      ipAddress: ip,
      userAgent: body?.userAgent,
    });

    await security.auditStore.log({
      actorUserId: safeAdmin.id,
      actorName: safeAdmin.name,
      actorEmail: safeAdmin.email,
      action: "FIRST_RUN_SETUP",
      entityType: "user",
      entityId: safeAdmin.id,
      ipAddress: ip,
      metadata: { role: "ADMIN" },
    });

    security.rateLimiter.recordSuccess(rateKey);

    return {
      user: safeAdmin,
      token: session.token,
    };
  } catch (err) {
    security.rateLimiter.recordFailure(rateKey);
    throw err;
  }
}

export async function loginHandler(
  security: SecurityContext,
  body: any,
  ip = "unknown",
  userAgent = ""
) {
  const loginKey = `login:${ip}:${(body?.login || body?.email || "").toLowerCase()}`;
  const rateStatus = security.rateLimiter.isBlocked(loginKey);
  if (rateStatus.blocked) {
    const err = new Error(`Too many login attempts. Please wait ${rateStatus.retryAfterSeconds} seconds.`);
    (err as any).status = 429;
    (err as any).code = "RATE_LIMITED";
    throw err;
  }

  const login = (body?.login || body?.email || "").trim();
  const password = body?.password || "";

  if (!login || !password) {
    const err = new Error("Email/username and password are required.");
    (err as any).status = 400;
    throw err;
  }

  try {
    const safeUser = await security.userStore.authenticate(login, password);
    if (!safeUser) {
      security.rateLimiter.recordFailure(loginKey);
      await security.auditStore.log({
        actorUserId: null,
        actorEmail: login,
        action: "FAILED_LOGIN",
        entityType: "auth",
        entityId: login,
        ipAddress: ip,
        metadata: { reason: "Invalid credentials" },
      });

      const err = new Error("Invalid email or password.");
      (err as any).status = 401;
      (err as any).code = "INVALID_CREDENTIALS";
      throw err;
    }

    security.rateLimiter.recordSuccess(loginKey);

    const session = await security.sessionStore.createSession(safeUser.id, {
      ipAddress: ip,
      userAgent,
    });

    await security.auditStore.log({
      actorUserId: safeUser.id,
      actorName: safeUser.name,
      actorEmail: safeUser.email,
      action: "LOGIN",
      entityType: "user",
      entityId: safeUser.id,
      ipAddress: ip,
    });

    return {
      user: safeUser,
      token: session.token,
    };
  } catch (err: any) {
    if (err.code === "ACCOUNT_DISABLED") {
      await security.auditStore.log({
        actorEmail: login,
        action: "FAILED_LOGIN",
        entityType: "auth",
        entityId: login,
        ipAddress: ip,
        metadata: { reason: "Account disabled" },
      });
    }
    throw err;
  }
}

export async function logoutHandler(
  security: SecurityContext,
  token: string | null,
  user?: SafeUser | null
) {
  if (token) {
    await security.sessionStore.revokeSession(token);
  }

  if (user) {
    await security.auditStore.log({
      actorUserId: user.id,
      actorName: user.name,
      actorEmail: user.email,
      action: "LOGOUT",
      entityType: "user",
      entityId: user.id,
    });
  }

  return { success: true };
}

export async function updateProfileHandler(
  security: SecurityContext,
  user: SafeUser,
  body: any
) {
  const updated = await security.userStore.updateUser(user.id, {
    name: body?.name,
    email: body?.email,
    avatar: body?.avatar,
  });

  await security.auditStore.log({
    actorUserId: user.id,
    actorName: user.name,
    actorEmail: user.email,
    action: "USER_UPDATED",
    entityType: "user",
    entityId: user.id,
    metadata: { changed: Object.keys(body || {}) },
  });

  return updated;
}

export async function changePasswordHandler(
  security: SecurityContext,
  user: SafeUser,
  body: any
) {
  const currentPassword = body?.currentPassword || "";
  const newPassword = body?.newPassword || "";
  const confirmPassword = body?.confirmPassword || "";

  if (!currentPassword || !newPassword) {
    const err = new Error("Current password and new password are required.");
    (err as any).status = 400;
    throw err;
  }

  if (newPassword !== confirmPassword) {
    const err = new Error("New password and confirmation do not match.");
    (err as any).status = 400;
    throw err;
  }

  const internalUser = await security.userStore.getInternalUserById(user.id);
  if (!internalUser) {
    const err = new Error("User not found.");
    (err as any).status = 404;
    throw err;
  }

  const isValid = await verifyPassword(currentPassword, internalUser.passwordHash);
  if (!isValid) {
    const err = new Error("Current password is incorrect.");
    (err as any).status = 400;
    (err as any).code = "INCORRECT_PASSWORD";
    throw err;
  }

  await security.userStore.resetPassword(user.id, newPassword);

  await security.auditStore.log({
    actorUserId: user.id,
    actorName: user.name,
    actorEmail: user.email,
    action: "PASSWORD_CHANGED",
    entityType: "user",
    entityId: user.id,
  });

  return { success: true };
}

export async function listSessionsHandler(
  security: SecurityContext,
  user: SafeUser,
  currentToken?: string
) {
  return security.sessionStore.listUserSessions(user.id, currentToken);
}

export async function revokeSessionHandler(
  security: SecurityContext,
  user: SafeUser,
  sessionId: string
) {
  const session = await security.sessionStore.getSessionById(sessionId);
  if (session && session.userId !== user.id && user.role !== "ADMIN") {
    const error = new Error("Forbidden: cannot revoke another user's session");
    (error as any).status = 403;
    throw error;
  }
  await security.sessionStore.revokeSession(sessionId);
  return { success: true };
}
