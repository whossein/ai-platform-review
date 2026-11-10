/**
 * Persistent Session Store & Token Lifecycle.
 *
 * Persists in `./.data/sessions.json`.
 *
 * Guarantees:
 *  - 256-bit cryptographically secure session tokens.
 *  - Configurable expiration (default: 7 days).
 *  - Automatic pruning of expired sessions.
 *  - Targeted session revocation or all-session invalidation on password change.
 *  - Session listing never exposes secret session tokens to the client.
 */

import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { AuthSession, SafeSession, IsoTimestamp } from "@ai-review/core";
import { generateSessionToken } from "./crypto-utils.js";

const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface SessionsFileSchema {
  sessions: Record<string, AuthSession>; // token -> session
}

export class SessionStore {
  private readonly filePath: string;
  private readonly dirPath: string;
  private sessions: Record<string, AuthSession> = {};
  private loaded = false;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(storageDir = "./.data") {
    this.dirPath = path.resolve(storageDir);
    this.filePath = path.join(this.dirPath, "sessions.json");
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      await fs.mkdir(this.dirPath, { recursive: true });
      const raw = await fs.readFile(this.filePath, "utf-8");
      const parsed: SessionsFileSchema = JSON.parse(raw);
      this.sessions = parsed.sessions || {};
    } catch {
      this.sessions = {};
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.mkdir(this.dirPath, { recursive: true });
      const tmpPath = `${this.filePath}.tmp.${Date.now()}`;
      const payload: SessionsFileSchema = { sessions: this.sessions };
      await fs.writeFile(tmpPath, JSON.stringify(payload, null, 2), "utf-8");
      await fs.rename(tmpPath, this.filePath);
    });
    return this.writeQueue;
  }

  /**
   * Create and persist a new session.
   */
  async createSession(
    userId: string,
    meta?: { userAgent?: string; ipAddress?: string; ttlMs?: number }
  ): Promise<AuthSession> {
    await this.ensureLoaded();
    const token = generateSessionToken();
    const sessionId = `sess_${Date.now()}_${randomBytes(4).toString("hex")}`;
    const now = Date.now();
    const expiresAt = new Date(now + (meta?.ttlMs || DEFAULT_SESSION_TTL_MS)).toISOString() as IsoTimestamp;
    const nowIso = new Date(now).toISOString() as IsoTimestamp;

    const session: AuthSession = {
      id: sessionId,
      token,
      userId,
      userAgent: meta?.userAgent,
      ipAddress: meta?.ipAddress,
      createdAt: nowIso,
      expiresAt,
      lastActiveAt: nowIso,
    };

    this.sessions[token] = session;
    await this.persist();
    return session;
  }

  /**
   * Validate a session token. Returns null if invalid or expired.
   */
  async validateSession(token: string): Promise<AuthSession | null> {
    if (!token) return null;
    await this.ensureLoaded();
    const session = this.sessions[token];
    if (!session) return null;

    const now = Date.now();
    const expires = new Date(session.expiresAt).getTime();
    if (now >= expires) {
      delete this.sessions[token];
      await this.persist();
      return null;
    }

    // Update lastActiveAt periodically (e.g. if > 1 minute since last update)
    const lastActive = new Date(session.lastActiveAt).getTime();
    if (now - lastActive > 60_000) {
      this.sessions[token] = {
        ...session,
        lastActiveAt: new Date(now).toISOString() as IsoTimestamp,
      };
      await this.persist();
    }

    return this.sessions[token] ?? null;
  }

  /**
   * Get an active session by session ID.
   */
  async getSessionById(sessionId: string): Promise<AuthSession | null> {
    await this.ensureLoaded();
    for (const sess of Object.values(this.sessions)) {
      if (sess.id === sessionId) {
        return sess;
      }
    }
    return null;
  }

  /**
   * Revoke a specific session by token or session ID.
   */
  async revokeSession(tokenOrId: string): Promise<void> {
    await this.ensureLoaded();
    if (this.sessions[tokenOrId]) {
      delete this.sessions[tokenOrId];
      await this.persist();
      return;
    }

    // Check by session ID
    for (const [tok, sess] of Object.entries(this.sessions)) {
      if (sess.id === tokenOrId) {
        delete this.sessions[tok];
        await this.persist();
        return;
      }
    }
  }

  /**
   * Revoke all sessions belonging to a specific user.
   */
  async revokeAllUserSessions(userId: string): Promise<void> {
    await this.ensureLoaded();
    let changed = false;
    for (const [tok, sess] of Object.entries(this.sessions)) {
      if (sess.userId === userId) {
        delete this.sessions[tok];
        changed = true;
      }
    }
    if (changed) {
      await this.persist();
    }
  }

  /**
   * List all active sessions for a user, sanitized without token secrets.
   */
  async listUserSessions(userId: string, currentToken?: string): Promise<SafeSession[]> {
    await this.ensureLoaded();
    const now = Date.now();
    const list: SafeSession[] = [];

    for (const [tok, sess] of Object.entries(this.sessions)) {
      if (sess.userId === userId) {
        if (new Date(sess.expiresAt).getTime() > now) {
          const { token: _, ...safe } = sess;
          list.push({
            ...safe,
            isCurrent: currentToken ? tok === currentToken : false,
          });
        }
      }
    }

    return list.sort(
      (a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime()
    );
  }
}
