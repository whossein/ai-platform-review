/**
 * Authentication, Authorization, RBAC, Credentials & Audit Logging Domain Models.
 *
 * Implements:
 *  - System-level roles: ADMIN, MEMBER
 *  - System-level extensible permissions
 *  - Project-level roles: OWNER, MANAGER, REVIEWER, VIEWER
 *  - Project-level extensible permissions
 *  - User entity and SafeUser contract
 *  - ProjectMember mapping
 *  - Encrypted Git credential specifications (GitHub, GitLab)
 *  - Security audit log specifications
 *  - Session models
 */

import type { IsoTimestamp, ProjectId } from "./ids.js";

export type UserRole = "ADMIN" | "MEMBER";
export type UserStatus = "ACTIVE" | "DISABLED";
export type ProjectRole = "OWNER" | "MANAGER" | "REVIEWER" | "VIEWER";
export type GitCredentialProvider = "github" | "gitlab";

export type SystemPermission =
  | "system:admin"
  | "users:view"
  | "users:create"
  | "users:edit"
  | "users:delete"
  | "projects:create"
  | "projects:view_all"
  | "audit:view";

export type ProjectPermission =
  | "project:view"
  | "project:review"
  | "project:manage"
  | "project:members"
  | "project:delete";

/**
 * System-level role permission mapping.
 */
export const ROLE_SYSTEM_PERMISSIONS: Record<UserRole, readonly SystemPermission[]> = {
  ADMIN: [
    "system:admin",
    "users:view",
    "users:create",
    "users:edit",
    "users:delete",
    "projects:create",
    "projects:view_all",
    "audit:view",
  ],
  MEMBER: [
    "projects:create",
  ],
};

/**
 * Project-level role permission mapping.
 */
export const PROJECT_ROLE_PERMISSIONS: Record<ProjectRole, readonly ProjectPermission[]> = {
  OWNER: [
    "project:view",
    "project:review",
    "project:manage",
    "project:members",
    "project:delete",
  ],
  MANAGER: [
    "project:view",
    "project:review",
    "project:manage",
    "project:members",
  ],
  REVIEWER: [
    "project:view",
    "project:review",
  ],
  VIEWER: [
    "project:view",
  ],
};

/**
 * Internal User entity. Passwords hashes are never sent across the wire.
 */
export interface User {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly role: UserRole;
  readonly status: UserStatus;
  readonly avatar?: string | undefined;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  readonly lastLoginAt?: IsoTimestamp | undefined;
}

/**
 * Public, sanitized user profile safe for API responses and client consumption.
 */
export type SafeUser = Omit<User, "passwordHash">;

/**
 * Membership connecting a User to a specific Project with a designated ProjectRole.
 */
export interface ProjectMember {
  readonly id: string;
  readonly projectId: ProjectId;
  readonly userId: string;
  readonly projectRole: ProjectRole;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

export interface ProjectMemberWithUser extends ProjectMember {
  readonly user: SafeUser;
}

/**
 * Encrypted payload stored at rest.
 */
export interface EncryptedSecret {
  readonly encryptedData: string; // hex
  readonly iv: string; // hex
  readonly tag: string; // hex
}

/**
 * Internal storage record for a user's git credentials.
 */
export interface GitCredentialRecord {
  readonly id: string;
  readonly userId: string;
  readonly provider: GitCredentialProvider;
  readonly encryptedToken: EncryptedSecret;
  readonly maskedToken: string;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

/**
 * Sanitized summary of Git credentials returned to the UI.
 * Never exposes the raw or encrypted token.
 */
export interface GitCredentialSummary {
  readonly provider: GitCredentialProvider;
  readonly connected: boolean;
  readonly maskedToken?: string | undefined;
  readonly updatedAt?: IsoTimestamp | undefined;
}

export type AuditAction =
  | "LOGIN"
  | "LOGOUT"
  | "FAILED_LOGIN"
  | "FIRST_RUN_SETUP"
  | "USER_CREATED"
  | "USER_UPDATED"
  | "USER_STATUS_CHANGED"
  | "USER_ROLE_CHANGED"
  | "USER_DELETED"
  | "PASSWORD_CHANGED"
  | "PASSWORD_RESET"
  | "PROJECT_CREATED"
  | "PROJECT_UPDATED"
  | "PROJECT_DELETED"
  | "PROJECT_MEMBER_ADDED"
  | "PROJECT_MEMBER_UPDATED"
  | "PROJECT_MEMBER_REMOVED"
  | "GIT_CREDENTIAL_CONNECTED"
  | "GIT_CREDENTIAL_REVOKED"
  | "REVIEW_STARTED"
  | "REVIEW_COMPLETED";

export interface AuditLogEntry {
  readonly id: string;
  readonly actorUserId?: string | null | undefined;
  readonly actorName?: string | undefined;
  readonly actorEmail?: string | undefined;
  readonly action: AuditAction;
  readonly entityType: string;
  readonly entityId: string;
  readonly metadata?: Record<string, unknown> | undefined;
  readonly ipAddress?: string | undefined;
  readonly createdAt: IsoTimestamp;
}

export interface AuthSession {
  readonly id: string;
  readonly token: string;
  readonly userId: string;
  readonly userAgent?: string | undefined;
  readonly ipAddress?: string | undefined;
  readonly createdAt: IsoTimestamp;
  readonly expiresAt: IsoTimestamp;
  readonly lastActiveAt: IsoTimestamp;
}

export type SafeSession = Omit<AuthSession, "token"> & {
  readonly isCurrent?: boolean | undefined;
};
