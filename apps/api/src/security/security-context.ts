/**
 * Central Security Context & Auth Utilities.
 *
 * Provides dependency injection and centralized access to:
 *  - User management (UserStore)
 *  - Sessions & tokens (SessionStore)
 *  - Project memberships & RBAC (ProjectMemberStore)
 *  - Encrypted Git credentials (CredentialStore)
 *  - Audit trail (AuditStore)
 *  - Rate limiter (RateLimiter)
 */

import type { Request, Response, NextFunction } from "express";
import type {
  SafeUser,
  AuthSession,
  SystemPermission,
  ProjectPermission,
  ProjectId,
} from "@ai-review/core";
import { ROLE_SYSTEM_PERMISSIONS } from "@ai-review/core";
import { UserStore } from "./user-store.js";
import { SessionStore } from "./session-store.js";
import { ProjectMemberStore } from "./project-member-store.js";
import { CredentialStore } from "./credential-store.js";
import { AuditStore } from "./audit-store.js";
import { RateLimiter } from "./rate-limiter.js";

export interface AuthenticatedContext {
  user: SafeUser;
  session: AuthSession;
}

export class SecurityContext {
  readonly userStore: UserStore;
  readonly sessionStore: SessionStore;
  readonly memberStore: ProjectMemberStore;
  readonly credentialStore: CredentialStore;
  readonly auditStore: AuditStore;
  readonly rateLimiter: RateLimiter;

  constructor(storageDir = "./.data") {
    this.userStore = new UserStore(storageDir);
    this.sessionStore = new SessionStore(storageDir);
    this.memberStore = new ProjectMemberStore(storageDir);
    this.credentialStore = new CredentialStore(storageDir);
    this.auditStore = new AuditStore(storageDir);
    this.rateLimiter = new RateLimiter();
  }

  /**
   * Extract session token from Express request or Node IncomingMessage.
   */
  extractToken(req: any): string | null {
    const authHeader = req.headers?.authorization || req.headers?.Authorization;
    if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
      return authHeader.substring(7).trim();
    }
    const tokenHeader = req.headers?.["x-session-token"];
    if (typeof tokenHeader === "string") {
      return tokenHeader.trim();
    }
    return null;
  }

  /**
   * Authenticate a request.
   * Returns AuthenticatedContext or null if token is missing/invalid/expired or user disabled.
   */
  async authenticateRequest(req: any): Promise<AuthenticatedContext | null> {
    const token = this.extractToken(req);
    if (!token) return null;

    const session = await this.sessionStore.validateSession(token);
    if (!session) return null;

    const user = await this.userStore.getUserById(session.userId);
    if (!user || user.status === "DISABLED") {
      // Invalidate session for disabled/deleted user
      await this.sessionStore.revokeSession(token);
      return null;
    }

    return { user, session };
  }

  /**
   * Express middleware enforcing authentication.
   */
  requireAuth() {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        const auth = await this.authenticateRequest(req);
        if (!auth) {
          return res.status(401).json({
            error: "Authentication required. Please sign in.",
            code: "UNAUTHORIZED",
          });
        }
        (req as any).user = auth.user;
        (req as any).session = auth.session;
        next();
      } catch (err: any) {
        res.status(500).json({ error: err.message || "Authentication error" });
      }
    };
  }

  /**
   * Express middleware enforcing administrator role.
   */
  requireAdmin() {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        const auth = await this.authenticateRequest(req);
        if (!auth) {
          return res.status(401).json({
            error: "Authentication required. Please sign in.",
            code: "UNAUTHORIZED",
          });
        }
        if (auth.user.role !== "ADMIN") {
          return res.status(403).json({
            error: "Access denied. Administrator privileges required.",
            code: "FORBIDDEN",
          });
        }
        (req as any).user = auth.user;
        (req as any).session = auth.session;
        next();
      } catch (err: any) {
        res.status(500).json({ error: err.message || "Authorization error" });
      }
    };
  }

  /**
   * Check whether a user has a specific project-level permission.
   */
  async canAccessProject(
    user: SafeUser,
    projectId: ProjectId,
    permission: ProjectPermission
  ): Promise<boolean> {
    return this.memberStore.checkPermission(projectId, user, permission);
  }

  /**
   * Check whether a user has a system-level permission.
   */
  hasSystemPermission(user: SafeUser, permission: SystemPermission): boolean {
    const permissions = ROLE_SYSTEM_PERMISSIONS[user.role] || [];
    return permissions.includes(permission);
  }
}
