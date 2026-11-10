/**
 * Encrypted Git Credential Storage & Management.
 *
 * Persists in `./.data/credentials.json`.
 *
 * Guarantees:
 *  - Sensitive Personal Access Tokens (PATs) are AES-256-GCM encrypted at rest.
 *  - Zero credential leakage: API contracts never expose raw tokens or encrypted blocks.
 *  - Only masked summaries (e.g. "ghp_••••••••1234") are returned to the user interface.
 *  - Decryption is strictly scoped to internal Git operations.
 */

import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  GitCredentialProvider,
  GitCredentialRecord,
  GitCredentialSummary,
  IsoTimestamp,
} from "@ai-review/core";
import { encryptSecret, decryptSecret, maskToken } from "./crypto-utils.js";

interface CredentialsFileSchema {
  credentials: Record<string, GitCredentialRecord>; // key: `${userId}:${provider}`
}

export class CredentialStore {
  private readonly filePath: string;
  private readonly dirPath: string;
  private credentials: Record<string, GitCredentialRecord> = {};
  private loaded = false;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(storageDir = "./.data") {
    this.dirPath = path.resolve(storageDir);
    this.filePath = path.join(this.dirPath, "credentials.json");
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      await fs.mkdir(this.dirPath, { recursive: true });
      const raw = await fs.readFile(this.filePath, "utf-8");
      const parsed: CredentialsFileSchema = JSON.parse(raw);
      this.credentials = parsed.credentials || {};
    } catch {
      this.credentials = {};
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.mkdir(this.dirPath, { recursive: true });
      const tmpPath = `${this.filePath}.tmp.${Date.now()}`;
      const payload: CredentialsFileSchema = { credentials: this.credentials };
      await fs.writeFile(tmpPath, JSON.stringify(payload, null, 2), "utf-8");
      await fs.rename(tmpPath, this.filePath);
    });
    return this.writeQueue;
  }

  private makeKey(userId: string, provider: GitCredentialProvider): string {
    return `${userId}:${provider.toLowerCase()}`;
  }

  /**
   * Set or replace a user's Git Personal Access Token.
   */
  async setCredential(
    userId: string,
    provider: GitCredentialProvider,
    rawToken: string
  ): Promise<GitCredentialSummary> {
    await this.ensureLoaded();
    const token = rawToken.trim();
    if (!token) {
      const err = new Error("Token cannot be empty.");
      (err as any).status = 400;
      throw err;
    }

    const encrypted = await encryptSecret(token, this.dirPath);
    const masked = maskToken(token);
    const now = new Date().toISOString() as IsoTimestamp;
    const key = this.makeKey(userId, provider);

    const record: GitCredentialRecord = {
      id: `cred_${Date.now()}_${randomBytes(4).toString("hex")}`,
      userId,
      provider,
      encryptedToken: encrypted,
      maskedToken: masked,
      createdAt: this.credentials[key]?.createdAt || now,
      updatedAt: now,
    };

    this.credentials[key] = record;
    await this.persist();

    return {
      provider,
      connected: true,
      maskedToken: masked,
      updatedAt: now,
    };
  }

  /**
   * Delete / revoke a user's stored credential.
   */
  async deleteCredential(userId: string, provider: GitCredentialProvider): Promise<void> {
    await this.ensureLoaded();
    const key = this.makeKey(userId, provider);
    if (this.credentials[key]) {
      delete this.credentials[key];
      await this.persist();
    }
  }

  /**
   * List credential summaries for supported providers for a user.
   */
  async listUserCredentials(userId: string): Promise<GitCredentialSummary[]> {
    await this.ensureLoaded();
    const supportedProviders: GitCredentialProvider[] = ["github", "gitlab"];

    return supportedProviders.map((provider) => {
      const key = this.makeKey(userId, provider);
      const record = this.credentials[key];
      if (record) {
        return {
          provider,
          connected: true,
          maskedToken: record.maskedToken,
          updatedAt: record.updatedAt,
        };
      }
      return {
        provider,
        connected: false,
      };
    });
  }

  /**
   * Internal retrieval of decrypted token for executing Git requests.
   * NEVER exposed via API responses or client payloads.
   */
  async getDecryptedToken(
    userId: string,
    provider: GitCredentialProvider
  ): Promise<string | null> {

    await this.ensureLoaded();
    const key = this.makeKey(userId, provider);
    const record = this.credentials[key];
    if (!record) return null;

    try {
      return await decryptSecret(record.encryptedToken, this.dirPath);
    } catch (err) {
      console.error(`Failed to decrypt credential for user ${userId} and provider ${provider}:`, err);
      return null;
    }
  }
}
