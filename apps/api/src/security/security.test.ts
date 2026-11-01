import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  SecurityContext,
  hashPassword,
  verifyPassword,
  encryptSecret,
  decryptSecret,
  maskToken,
} from "./index.js";
import type { ProjectId } from "@ai-review/core";

describe("Security & Access Control Subsystem", () => {
  let tmpDir: string;
  let security: SecurityContext;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-review-sec-test-"));
    security = new SecurityContext(tmpDir);
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignored
    }
  });

  describe("Cryptographic Utilities", () => {
    it("hashes and verifies passwords securely using PBKDF2 salt:hash", async () => {
      const pass = "SuperSecret123!";
      const hash = await hashPassword(pass);

      expect(hash).toMatch(/^pbkdf2:100000:[a-f0-9]{32}:[a-f0-9]{128}$/);
      expect(await verifyPassword(pass, hash)).toBe(true);
      expect(await verifyPassword("WrongPassword!", hash)).toBe(false);
      expect(await verifyPassword("", hash)).toBe(false);
    });

    it("encrypts and decrypts secrets at rest using AES-256-GCM", async () => {
      const token = "glpat-secret_access_token_xyz_987";
      const encrypted = await encryptSecret(token, tmpDir);

      expect(encrypted.encryptedData).toBeDefined();
      expect(encrypted.iv).toBeDefined();
      expect(encrypted.tag).toBeDefined();
      expect(encrypted.encryptedData).not.toContain(token);

      const decrypted = await decryptSecret(encrypted, tmpDir);
      expect(decrypted).toBe(token);
    });

    it("masks sensitive tokens properly for display", () => {
      expect(maskToken("ghp_1234567890abcdef")).toBe("ghp_••••••••cdef");
      expect(maskToken("glpat-abcdef123456789")).toBe("glpa••••••••6789");
      expect(maskToken("short")).toBe("••••••••");
      expect(maskToken("")).toBe("");
    });
  });

  describe("First-Run & User Lifecycle", () => {
    it("reports first-run as true initially, and allows creating the first admin", async () => {
      expect(await security.userStore.isFirstRun()).toBe(true);

      const admin = await security.userStore.setupFirstAdmin({
        name: "First Administrator",
        email: "admin@company.com",
        password: "AdminPassword123!",
      });

      expect(admin.role).toBe("ADMIN");
      expect(admin.status).toBe("ACTIVE");
      expect(admin.email).toBe("admin@company.com");
      expect((admin as any).passwordHash).toBeUndefined(); // Never leaked

      // Once admin exists, isFirstRun becomes false
      expect(await security.userStore.isFirstRun()).toBe(false);
    });

    it("permanently blocks first-run setup once an administrator exists", async () => {
      await security.userStore.setupFirstAdmin({
        name: "Admin One",
        email: "admin1@company.com",
        password: "Password12345!",
      });

      await expect(
        security.userStore.setupFirstAdmin({
          name: "Attacker",
          email: "attacker@company.com",
          password: "AttackerPassword123!",
        })
      ).rejects.toThrow(/First-run setup is permanently unavailable/);
    });

    it("authenticates active users and rejects invalid credentials", async () => {
      await security.userStore.setupFirstAdmin({
        name: "John Admin",
        email: "john@company.com",
        password: "CorrectPassword123!",
      });

      const user = await security.userStore.authenticate("john@company.com", "CorrectPassword123!");
      expect(user).not.toBeNull();
      expect(user?.email).toBe("john@company.com");

      // Invalid password
      const wrong = await security.userStore.authenticate("john@company.com", "WrongPassword!");
      expect(wrong).toBeNull();

      // Case-insensitive email
      const caseUser = await security.userStore.authenticate("JOHN@company.com", "CorrectPassword123!");
      expect(caseUser).not.toBeNull();
    });

    it("blocks disabled users from authenticating and invalidates sessions", async () => {
      const admin = await security.userStore.setupFirstAdmin({
        name: "Admin",
        email: "admin@company.com",
        password: "Password12345!",
      });
      expect(admin.role).toBe("ADMIN");

      const member = await security.userStore.createUser({
        name: "Alice Member",
        email: "alice@company.com",
        password: "MemberPass123!",
        role: "MEMBER",
      });

      // Create session for member
      const session = await security.sessionStore.createSession(member.id);
      expect(await security.sessionStore.validateSession(session.token)).not.toBeNull();

      // Disable member
      await security.userStore.setUserStatus(member.id, "DISABLED");

      // Login fails
      await expect(
        security.userStore.authenticate("alice@company.com", "MemberPass123!")
      ).rejects.toThrow(/disabled/);

      // Authenticate request fails
      const req = { headers: { authorization: `Bearer ${session.token}` } };
      const authResult = await security.authenticateRequest(req);
      expect(authResult).toBeNull();
    });

    it("enforces last-admin protection on delete, disable, and demote", async () => {
      const admin = await security.userStore.setupFirstAdmin({
        name: "Sole Admin",
        email: "admin@company.com",
        password: "Password12345!",
      });

      // Cannot delete the only admin
      await expect(security.userStore.deleteUser(admin.id)).rejects.toThrow(
        /Cannot delete the last (active|remaining) administrator/
      );

      // Cannot disable the only admin
      await expect(security.userStore.setUserStatus(admin.id, "DISABLED")).rejects.toThrow(
        /Cannot disable the last (active|remaining) administrator/
      );

      // Cannot demote the only admin
      await expect(security.userStore.setUserRole(admin.id, "MEMBER")).rejects.toThrow(
        /Cannot demote the last (active|remaining) administrator/
      );

      // Create a second admin
      const admin2 = await security.userStore.createUser({
        name: "Second Admin",
        email: "admin2@company.com",
        password: "Password22222!",
        role: "ADMIN",
      });

      // Now deleting the first admin is allowed because admin2 remains active
      await expect(security.userStore.deleteUser(admin.id)).resolves.not.toThrow();

      // Now admin2 is the sole remaining admin, cannot delete admin2
      await expect(security.userStore.deleteUser(admin2.id)).rejects.toThrow(
        /Cannot delete the last (active|remaining) administrator/
      );
    });
  });

  describe("Session Life Cycle", () => {
    it("creates, validates, and revokes sessions", async () => {
      const session = await security.sessionStore.createSession("user_123");
      expect(session.token.length).toBe(64); // 32 bytes hex

      const valid = await security.sessionStore.validateSession(session.token);
      expect(valid).not.toBeNull();
      expect(valid?.userId).toBe("user_123");

      await security.sessionStore.revokeSession(session.token);
      const afterRevoke = await security.sessionStore.validateSession(session.token);
      expect(afterRevoke).toBeNull();
    });

    it("lists sessions without exposing secret session tokens", async () => {
      const s1 = await security.sessionStore.createSession("user_456");
      const s2 = await security.sessionStore.createSession("user_456");

      const list = await security.sessionStore.listUserSessions("user_456", s1.token);
      expect(list.length).toBe(2);
      expect(list.find((s) => s.id === s1.id)?.isCurrent).toBe(true);
      expect(list.find((s) => s.id === s2.id)?.isCurrent).toBe(false);

      for (const item of list) {
        expect((item as any).token).toBeUndefined(); // Token never returned!
      }
    });
  });

  describe("Project-Level Access & RBAC", () => {
    const projectId = "proj_test_100" as ProjectId;

    it("system ADMIN has full access across all projects unconditionally", async () => {
      const admin = await security.userStore.setupFirstAdmin({
        name: "Admin User",
        email: "admin@company.com",
        password: "AdminPass123!",
      });

      expect(await security.canAccessProject(admin, projectId, "project:view")).toBe(true);
      expect(await security.canAccessProject(admin, projectId, "project:review")).toBe(true);
      expect(await security.canAccessProject(admin, projectId, "project:manage")).toBe(true);
      expect(await security.canAccessProject(admin, projectId, "project:members")).toBe(true);
      expect(await security.canAccessProject(admin, projectId, "project:delete")).toBe(true);
    });

    it("MEMBER without membership is rejected from project", async () => {
      await security.userStore.setupFirstAdmin({
        name: "Admin",
        email: "admin@company.com",
        password: "AdminPass123!",
      });

      const member = await security.userStore.createUser({
        name: "Normal Member",
        email: "member@company.com",
        password: "MemberPass123!",
        role: "MEMBER",
      });

      expect(await security.canAccessProject(member, projectId, "project:view")).toBe(false);
      expect(await security.canAccessProject(member, projectId, "project:review")).toBe(false);
    });

    it("enforces granular permissions according to project role", async () => {
      await security.userStore.setupFirstAdmin({
        name: "Admin",
        email: "admin@company.com",
        password: "AdminPass123!",
      });

      const reviewerUser = await security.userStore.createUser({
        name: "Reviewer User",
        email: "reviewer@company.com",
        password: "ReviewerPass123!",
        role: "MEMBER",
      });

      const viewerUser = await security.userStore.createUser({
        name: "Viewer User",
        email: "viewer@company.com",
        password: "ViewerPass123!",
        role: "MEMBER",
      });

      await security.memberStore.addMember(projectId, reviewerUser.id, "REVIEWER");
      await security.memberStore.addMember(projectId, viewerUser.id, "VIEWER");

      // REVIEWER can view and review, but cannot manage or delete
      expect(await security.canAccessProject(reviewerUser, projectId, "project:view")).toBe(true);
      expect(await security.canAccessProject(reviewerUser, projectId, "project:review")).toBe(true);
      expect(await security.canAccessProject(reviewerUser, projectId, "project:manage")).toBe(false);
      expect(await security.canAccessProject(reviewerUser, projectId, "project:delete")).toBe(false);

      // VIEWER can only view
      expect(await security.canAccessProject(viewerUser, projectId, "project:view")).toBe(true);
      expect(await security.canAccessProject(viewerUser, projectId, "project:review")).toBe(false);
      expect(await security.canAccessProject(viewerUser, projectId, "project:manage")).toBe(false);
    });

    it("allows updating and removing project memberships", async () => {
      await security.userStore.setupFirstAdmin({
        name: "Admin",
        email: "admin@company.com",
        password: "AdminPass123!",
      });

      const user = await security.userStore.createUser({
        name: "Bob",
        email: "bob@company.com",
        password: "BobPassword123!",
        role: "MEMBER",
      });

      await security.memberStore.addMember(projectId, user.id, "VIEWER");
      expect(await security.memberStore.getUserProjectRole(projectId, user.id)).toBe("VIEWER");

      await security.memberStore.updateMemberRole(projectId, user.id, "MANAGER");
      expect(await security.memberStore.getUserProjectRole(projectId, user.id)).toBe("MANAGER");

      await security.memberStore.removeMember(projectId, user.id);
      expect(await security.memberStore.getUserProjectRole(projectId, user.id)).toBeNull();
    });
  });

  describe("Encrypted Git Credentials", () => {
    it("stores encrypted Git credentials and provides masked display summary", async () => {
      const rawToken = "ghp_0123456789abcdefghijklmnopqrstuvwxyz";
      const summary = await security.credentialStore.setCredential(
        "user_test",
        "github",
        rawToken
      );

      expect(summary.connected).toBe(true);
      expect(summary.provider).toBe("github");
      expect(summary.maskedToken).toBe("ghp_••••••••wxyz");
      expect((summary as any).token).toBeUndefined(); // Raw token never returned

      // List credentials
      const list = await security.credentialStore.listUserCredentials("user_test");
      const ghItem = list.find((c) => c.provider === "github");
      expect(ghItem?.connected).toBe(true);
      expect(ghItem?.maskedToken).toBe("ghp_••••••••wxyz");

      // Internal decrypt
      const decrypted = await security.credentialStore.getDecryptedToken("user_test", "github");
      expect(decrypted).toBe(rawToken);

      // Revoke credential
      await security.credentialStore.deleteCredential("user_test", "github");
      expect(await security.credentialStore.getDecryptedToken("user_test", "github")).toBeNull();
    });
  });

  describe("Security Audit Log", () => {
    it("records audit actions and sanitizes sensitive metadata fields", async () => {
      await security.auditStore.log({
        actorUserId: "user_adm",
        actorName: "Admin",
        actorEmail: "admin@test.com",
        action: "PASSWORD_CHANGED",
        entityType: "user",
        entityId: "user_adm",
        metadata: {
          secret: "ShouldBeRedacted",
          password: "PlainTextPassword",
          token: "RawTokenValue",
          safeInfo: "ThisIsSafe",
        },
      });

      const result = await security.auditStore.query({ action: "PASSWORD_CHANGED" });
      expect(result.total).toBe(1);
      const entry = result.logs[0];
      expect(entry).toBeDefined();
      expect(entry!.action).toBe("PASSWORD_CHANGED");
      expect(entry!.metadata?.safeInfo).toBe("ThisIsSafe");
      expect(entry!.metadata?.secret).toBe("[REDACTED]");
      expect(entry!.metadata?.password).toBe("[REDACTED]");
      expect(entry!.metadata?.token).toBe("[REDACTED]");
    });
  });
});
