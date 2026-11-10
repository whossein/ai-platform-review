/**
 * Audit Logging Service & Security Trail.
 *
 * Persists in `./.data/audit-logs.json`.
 *
 * Guarantees:
 *  - Strict metadata sanitization: Passwords, tokens, and authorization headers are never logged.
 *  - Structured action categorization.
 *  - Search and filter queries for administrator review.
 *  - Atomic persistent writes.
 */

import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { AuditLogEntry, AuditAction, IsoTimestamp } from "@ai-review/core";

const SENSITIVE_KEYS = new Set([
  "password",
  "pass",
  "token",
  "secret",
  "authorization",
  "auth",
  "cookie",
  "passwordhash",
  "apikey",
  "api_key",
  "access_token",
  "pat",
]);

function sanitizeMetadata(data?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!data || typeof data !== "object") return undefined;
  const clean: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(data)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      clean[k] = "[REDACTED]";
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      clean[k] = sanitizeMetadata(v as Record<string, unknown>);
    } else {
      clean[k] = v;
    }
  }

  return clean;
}

interface AuditFileSchema {
  logs: AuditLogEntry[];
}

export class AuditStore {
  private readonly filePath: string;
  private readonly dirPath: string;
  private logs: AuditLogEntry[] = [];
  private loaded = false;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(storageDir = "./.data") {
    this.dirPath = path.resolve(storageDir);
    this.filePath = path.join(this.dirPath, "audit-logs.json");
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      await fs.mkdir(this.dirPath, { recursive: true });
      const raw = await fs.readFile(this.filePath, "utf-8");
      const parsed: AuditFileSchema = JSON.parse(raw);
      this.logs = parsed.logs || [];
    } catch {
      this.logs = [];
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.mkdir(this.dirPath, { recursive: true });
      const tmpPath = `${this.filePath}.tmp.${Date.now()}`;
      // Keep last 10,000 logs in storage to avoid unbounded growth
      const truncated = this.logs.slice(-10_000);
      const payload: AuditFileSchema = { logs: truncated };
      await fs.writeFile(tmpPath, JSON.stringify(payload, null, 2), "utf-8");
      await fs.rename(tmpPath, this.filePath);
    });
    return this.writeQueue;
  }

  /**
   * Record an audit event.
   */
  async log(entry: {
    actorUserId?: string | null;
    actorName?: string;
    actorEmail?: string;
    action: AuditAction;
    entityType: string;
    entityId: string;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
  }): Promise<AuditLogEntry> {
    await this.ensureLoaded();
    const now = new Date().toISOString() as IsoTimestamp;
    const logEntry: AuditLogEntry = {
      id: `audit_${Date.now()}_${randomBytes(4).toString("hex")}`,
      actorUserId: entry.actorUserId || null,
      actorName: entry.actorName,
      actorEmail: entry.actorEmail,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      metadata: sanitizeMetadata(entry.metadata),
      ipAddress: entry.ipAddress,
      createdAt: now,
    };

    this.logs.push(logEntry);
    await this.persist();
    return logEntry;
  }

  /**
   * Query logs with optional filtering and pagination.
   */
  async query(options?: {
    action?: AuditAction | undefined;
    actorUserId?: string | undefined;
    entityType?: string | undefined;
    entityId?: string | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
  }): Promise<{ logs: AuditLogEntry[]; total: number }> {
    await this.ensureLoaded();
    let filtered = [...this.logs];

    if (options?.action) {
      filtered = filtered.filter((l) => l.action === options.action);
    }
    if (options?.actorUserId) {
      filtered = filtered.filter((l) => l.actorUserId === options.actorUserId);
    }
    if (options?.entityType) {
      filtered = filtered.filter((l) => l.entityType === options.entityType);
    }
    if (options?.entityId) {
      filtered = filtered.filter((l) => l.entityId === options.entityId);
    }

    // Newest first
    filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const total = filtered.length;
    const offset = options?.offset || 0;
    const limit = options?.limit || 100;
    const sliced = filtered.slice(offset, offset + limit);

    return {
      logs: sliced,
      total,
    };
  }
}
