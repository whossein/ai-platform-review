/**
 * Persistent User Store & RBAC Entity Management.
 *
 * Persists in `./.data/users.json`.
 *
 * Guarantees:
 *  - First-run detection (zero users in system).
 *  - First-run admin initialization. Setup becomes permanently disabled once any user exists.
 *  - Unique case-insensitive email/username enforcement.
 *  - Passwords are strictly hashed via PBKDF2; plaintext is never stored or returned.
 *  - SafeUser transformations strip `passwordHash` before crossing boundaries.
 *  - Last-admin protection: Prevents deleting, disabling, or demoting the last active administrator.
 *  - Disabled users cannot authenticate or maintain active sessions.
 *  - Atomic file writes for crash safety.
 */

import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { User, SafeUser, UserRole, UserStatus, IsoTimestamp } from "@ai-review/core";
import { hashPassword, verifyPassword } from "./crypto-utils.js";

interface UsersFileSchema {
  users: Record<string, User>;
}

export class UserStore {
  private readonly filePath: string;
  private readonly dirPath: string;
  private users: Record<string, User> = {};
  private loaded = false;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(storageDir = "./.data") {
    this.dirPath = path.resolve(storageDir);
    this.filePath = path.join(this.dirPath, "users.json");
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      await fs.mkdir(this.dirPath, { recursive: true });
      const raw = await fs.readFile(this.filePath, "utf-8");
      const parsed: UsersFileSchema = JSON.parse(raw);
      this.users = parsed.users || {};
    } catch {
      this.users = {};
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.mkdir(this.dirPath, { recursive: true });
      const tmpPath = `${this.filePath}.tmp.${Date.now()}`;
      const payload: UsersFileSchema = { users: this.users };
      await fs.writeFile(tmpPath, JSON.stringify(payload, null, 2), "utf-8");
      await fs.rename(tmpPath, this.filePath);
    });
    return this.writeQueue;
  }

  static toSafeUser(user: User): SafeUser {
    const { passwordHash: _, ...safe } = user;
    return safe;
  }

  /**
   * Returns true if no users exist in the database (First Run condition).
   */
  async isFirstRun(): Promise<boolean> {
    await this.ensureLoaded();
    return Object.keys(this.users).length === 0;
  }

  /**
   * Initializes the first administrator during first run.
   * Throws if any user already exists.
   */
  async setupFirstAdmin(params: {
    name: string;
    email: string;
    password: string;
  }): Promise<SafeUser> {
    await this.ensureLoaded();
    if (Object.keys(this.users).length > 0) {
      const err = new Error("First-run setup is permanently unavailable because an administrator already exists.");
      (err as any).status = 403;
      (err as any).code = "SETUP_ALREADY_COMPLETED";
      throw err;
    }

    const email = params.email.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      const err = new Error("A valid email address is required.");
      (err as any).status = 400;
      throw err;
    }

    if (!params.password || params.password.length < 8) {
      const err = new Error("Password must be at least 8 characters long.");
      (err as any).status = 400;
      throw err;
    }

    const now = new Date().toISOString() as IsoTimestamp;
    const userId = `user_${Date.now()}_${randomBytes(4).toString("hex")}`;
    const passwordHash = await hashPassword(params.password);

    const user: User = {
      id: userId,
      name: params.name.trim() || "Administrator",
      email,
      passwordHash,
      role: "ADMIN",
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    };

    this.users[userId] = user;
    await this.persist();
    return UserStore.toSafeUser(user);
  }

  /**
   * Authenticate a user by email/username and password.
   */
  async authenticate(login: string, password: string): Promise<SafeUser | null> {
    await this.ensureLoaded();
    const normalized = login.trim().toLowerCase();
    const user = Object.values(this.users).find(
      (u) => u.email.toLowerCase() === normalized
    );

    if (!user) {
      return null;
    }

    if (user.status === "DISABLED") {
      const err = new Error("This account is currently disabled. Please contact your system administrator.");
      (err as any).status = 403;
      (err as any).code = "ACCOUNT_DISABLED";
      throw err;
    }

    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      return null;
    }

    // Update lastLoginAt
    const now = new Date().toISOString() as IsoTimestamp;
    const updated: User = {
      ...user,
      lastLoginAt: now,
      updatedAt: now,
    };
    this.users[user.id] = updated;
    await this.persist();

    return UserStore.toSafeUser(updated);
  }

  /**
   * List all users without sensitive hashes.
   */
  async listUsers(): Promise<SafeUser[]> {
    await this.ensureLoaded();
    return Object.values(this.users)
      .map(UserStore.toSafeUser)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  /**
   * Get safe user by ID.
   */
  async getUserById(id: string): Promise<SafeUser | null> {
    await this.ensureLoaded();
    const user = this.users[id];
    return user ? UserStore.toSafeUser(user) : null;
  }

  /**
   * Internal lookup with password hash for password change workflows.
   */
  async getInternalUserById(id: string): Promise<User | null> {
    await this.ensureLoaded();
    return this.users[id] || null;
  }

  /**
   * Create a new user (admin operation).
   */
  async createUser(params: {
    name: string;
    email: string;
    password: string;
    role?: UserRole;
    status?: UserStatus;
    avatar?: string;
  }): Promise<SafeUser> {
    await this.ensureLoaded();
    const email = params.email.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      const err = new Error("A valid email address is required.");
      (err as any).status = 400;
      throw err;
    }

    const exists = Object.values(this.users).some(
      (u) => u.email.toLowerCase() === email
    );
    if (exists) {
      const err = new Error(`A user with email "${email}" already exists.`);
      (err as any).status = 409;
      (err as any).code = "EMAIL_ALREADY_EXISTS";
      throw err;
    }

    if (!params.password || params.password.length < 8) {
      const err = new Error("Password must be at least 8 characters long.");
      (err as any).status = 400;
      throw err;
    }

    const now = new Date().toISOString() as IsoTimestamp;
    const userId = `user_${Date.now()}_${randomBytes(4).toString("hex")}`;
    const passwordHash = await hashPassword(params.password);

    const user: User = {
      id: userId,
      name: params.name.trim(),
      email,
      passwordHash,
      role: params.role || "MEMBER",
      status: params.status || "ACTIVE",
      avatar: params.avatar,
      createdAt: now,
      updatedAt: now,
    };

    this.users[userId] = user;
    await this.persist();
    return UserStore.toSafeUser(user);
  }

  /**
   * Update user details (name, email, avatar).
   */
  async updateUser(
    id: string,
    updates: { name?: string; email?: string; avatar?: string }
  ): Promise<SafeUser> {
    await this.ensureLoaded();
    const user = this.users[id];
    if (!user) {
      const err = new Error(`User "${id}" not found.`);
      (err as any).status = 404;
      throw err;
    }

    let email = user.email;
    if (updates.email && updates.email.trim()) {
      const normalized = updates.email.trim().toLowerCase();
      if (!normalized.includes("@")) {
        const err = new Error("A valid email address is required.");
        (err as any).status = 400;
        throw err;
      }
      const duplicate = Object.values(this.users).find(
        (u) => u.id !== id && u.email.toLowerCase() === normalized
      );
      if (duplicate) {
        const err = new Error(`A user with email "${normalized}" already exists.`);
        (err as any).status = 409;
        throw err;
      }
      email = normalized;
    }

    const now = new Date().toISOString() as IsoTimestamp;
    const updated: User = {
      ...user,
      name: updates.name !== undefined ? updates.name.trim() : user.name,
      email,
      avatar: updates.avatar !== undefined ? updates.avatar : user.avatar,
      updatedAt: now,
    };

    this.users[id] = updated;
    await this.persist();
    return UserStore.toSafeUser(updated);
  }

  /**
   * Count active administrators.
   */
  private getActiveAdminCount(excludeUserId?: string): number {
    return Object.values(this.users).filter(
      (u) => u.role === "ADMIN" && u.status === "ACTIVE" && u.id !== excludeUserId
    ).length;
  }

  /**
   * Enable or disable a user. Prevents disabling the last remaining administrator.
   */
  async setUserStatus(id: string, status: UserStatus): Promise<SafeUser> {
    await this.ensureLoaded();
    const user = this.users[id];
    if (!user) {
      const err = new Error(`User "${id}" not found.`);
      (err as any).status = 404;
      throw err;
    }

    if (user.role === "ADMIN" && status === "DISABLED") {
      const remainingAdmins = this.getActiveAdminCount(id);
      if (remainingAdmins === 0) {
        const err = new Error("Cannot disable the last active administrator.");
        (err as any).status = 400;
        (err as any).code = "CANNOT_DISABLE_LAST_ADMIN";
        throw err;
      }
    }

    const now = new Date().toISOString() as IsoTimestamp;
    const updated: User = {
      ...user,
      status,
      updatedAt: now,
    };

    this.users[id] = updated;
    await this.persist();
    return UserStore.toSafeUser(updated);
  }

  /**
   * Change user role. Prevents demoting the last remaining active administrator.
   */
  async setUserRole(id: string, role: UserRole): Promise<SafeUser> {
    await this.ensureLoaded();
    const user = this.users[id];
    if (!user) {
      const err = new Error(`User "${id}" not found.`);
      (err as any).status = 404;
      throw err;
    }

    if (user.role === "ADMIN" && role !== "ADMIN") {
      const remainingAdmins = this.getActiveAdminCount(id);
      if (remainingAdmins === 0) {
        const err = new Error("Cannot demote the last active administrator.");
        (err as any).status = 400;
        (err as any).code = "CANNOT_DEMOTE_LAST_ADMIN";
        throw err;
      }
    }

    const now = new Date().toISOString() as IsoTimestamp;
    const updated: User = {
      ...user,
      role,
      updatedAt: now,
    };

    this.users[id] = updated;
    await this.persist();
    return UserStore.toSafeUser(updated);
  }

  /**
   * Reset user password (admin operation or self change).
   */
  async resetPassword(id: string, newPassword: string): Promise<void> {
    await this.ensureLoaded();
    const user = this.users[id];
    if (!user) {
      const err = new Error(`User "${id}" not found.`);
      (err as any).status = 404;
      throw err;
    }

    if (!newPassword || newPassword.length < 8) {
      const err = new Error("Password must be at least 8 characters long.");
      (err as any).status = 400;
      throw err;
    }

    const passwordHash = await hashPassword(newPassword);
    const now = new Date().toISOString() as IsoTimestamp;
    this.users[id] = {
      ...user,
      passwordHash,
      updatedAt: now,
    };

    await this.persist();
  }

  /**
   * Delete a user. Prevents deleting the last remaining administrator.
   */
  async deleteUser(id: string): Promise<void> {
    await this.ensureLoaded();
    const user = this.users[id];
    if (!user) {
      const err = new Error(`User "${id}" not found.`);
      (err as any).status = 404;
      throw err;
    }

    if (user.role === "ADMIN") {
      const remainingAdmins = this.getActiveAdminCount(id);
      if (remainingAdmins === 0) {
        const err = new Error("Cannot delete the last remaining administrator.");
        (err as any).status = 400;
        (err as any).code = "CANNOT_DELETE_LAST_ADMIN";
        throw err;
      }
    }

    delete this.users[id];
    await this.persist();
  }
}
