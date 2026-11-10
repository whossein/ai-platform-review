/**
 * Persistent Project Membership & Role-Based Access Control.
 *
 * Persists in `./.data/project-members.json`.
 *
 * Guarantees:
 *  - Unique (projectId, userId) constraint.
 *  - Strict role assignments: OWNER, MANAGER, REVIEWER, VIEWER.
 *  - Atomic writes and consistent state.
 *  - Global ADMIN privilege evaluation: system administrators inherit full access across all projects.
 */

import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  ProjectMember,
  ProjectRole,
  ProjectPermission,
  SafeUser,
  ProjectId,
  IsoTimestamp,
} from "@ai-review/core";
import { PROJECT_ROLE_PERMISSIONS } from "@ai-review/core";

interface MembersFileSchema {
  members: Record<string, ProjectMember>; // memberId -> ProjectMember
}

export class ProjectMemberStore {
  private readonly filePath: string;
  private readonly dirPath: string;
  private members: Record<string, ProjectMember> = {};
  private loaded = false;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(storageDir = "./.data") {
    this.dirPath = path.resolve(storageDir);
    this.filePath = path.join(this.dirPath, "project-members.json");
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      await fs.mkdir(this.dirPath, { recursive: true });
      const raw = await fs.readFile(this.filePath, "utf-8");
      const parsed: MembersFileSchema = JSON.parse(raw);
      this.members = parsed.members || {};
    } catch {
      this.members = {};
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.mkdir(this.dirPath, { recursive: true });
      const tmpPath = `${this.filePath}.tmp.${Date.now()}`;
      const payload: MembersFileSchema = { members: this.members };
      await fs.writeFile(tmpPath, JSON.stringify(payload, null, 2), "utf-8");
      await fs.rename(tmpPath, this.filePath);
    });
    return this.writeQueue;
  }

  /**
   * Add a user to a project with a specific ProjectRole.
   */
  async addMember(
    projectId: ProjectId,
    userId: string,
    projectRole: ProjectRole
  ): Promise<ProjectMember> {
    await this.ensureLoaded();

    const existing = Object.values(this.members).find(
      (m) => m.projectId === projectId && m.userId === userId
    );
    if (existing) {
      const err = new Error(`User is already a member of this project.`);
      (err as any).status = 409;
      (err as any).code = "MEMBER_ALREADY_EXISTS";
      throw err;
    }

    const now = new Date().toISOString() as IsoTimestamp;
    const memberId = `pm_${Date.now()}_${randomBytes(4).toString("hex")}`;

    const member: ProjectMember = {
      id: memberId,
      projectId,
      userId,
      projectRole,
      createdAt: now,
      updatedAt: now,
    };

    this.members[memberId] = member;
    await this.persist();
    return member;
  }

  /**
   * Update a user's role inside a project.
   */
  async updateMemberRole(
    projectId: ProjectId,
    userId: string,
    projectRole: ProjectRole
  ): Promise<ProjectMember> {
    await this.ensureLoaded();

    const existing = Object.values(this.members).find(
      (m) => m.projectId === projectId && m.userId === userId
    );
    if (!existing) {
      const err = new Error(`Membership record not found for user in this project.`);
      (err as any).status = 404;
      throw err;
    }

    const now = new Date().toISOString() as IsoTimestamp;
    const updated: ProjectMember = {
      ...existing,
      projectRole,
      updatedAt: now,
    };

    this.members[existing.id] = updated;
    await this.persist();
    return updated;
  }

  /**
   * Remove a user from a project.
   */
  async removeMember(projectId: ProjectId, userId: string): Promise<void> {
    await this.ensureLoaded();

    const existing = Object.values(this.members).find(
      (m) => m.projectId === projectId && m.userId === userId
    );
    if (!existing) {
      const err = new Error(`Membership record not found.`);
      (err as any).status = 404;
      throw err;
    }

    delete this.members[existing.id];
    await this.persist();
  }

  /**
   * Retrieve single membership record.
   */
  async getMember(
    projectId: ProjectId,
    userId: string
  ): Promise<ProjectMember | null> {
    await this.ensureLoaded();
    const found = Object.values(this.members).find(
      (m) => m.projectId === projectId && m.userId === userId
    );
    return found || null;
  }

  /**
   * List all members of a project.
   */
  async listProjectMembers(projectId: ProjectId): Promise<ProjectMember[]> {
    await this.ensureLoaded();
    return Object.values(this.members).filter((m) => m.projectId === projectId);
  }

  /**
   * List all projects a user is assigned to.
   */
  async listUserMemberships(userId: string): Promise<ProjectMember[]> {
    await this.ensureLoaded();
    return Object.values(this.members).filter((m) => m.userId === userId);
  }

  /**
   * Get user's role in a project. Returns null if not a member.
   */
  async getUserProjectRole(
    projectId: ProjectId,
    userId: string
  ): Promise<ProjectRole | null> {
    const member = await this.getMember(projectId, userId);
    return member ? member.projectRole : null;
  }

  /**
   * Authorize a user against a project permission.
   * System administrators always pass.
   */
  async checkPermission(
    projectId: ProjectId,
    user: SafeUser,
    permission: ProjectPermission
  ): Promise<boolean> {
    if (user.role === "ADMIN") {
      return true;
    }

    const role = await this.getUserProjectRole(projectId, user.id);
    if (!role) {
      return false;
    }

    const allowedPermissions = PROJECT_ROLE_PERMISSIONS[role] || [];
    return allowedPermissions.includes(permission);
  }
}
