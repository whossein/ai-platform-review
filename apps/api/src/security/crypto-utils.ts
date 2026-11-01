/**
 * Cryptographic and security primitives for user passwords, sessions, and encrypted credentials.
 *
 * Guarantees:
 *  - Password hashing with random salt and PBKDF2 (SHA-512, 100,000 iterations).
 *  - Constant-time password comparisons preventing timing attacks.
 *  - High-entropy cryptographic session tokens (256-bit).
 *  - Authenticated encryption (AES-256-GCM) for sensitive Git credentials at rest.
 *  - Automatic generation and persistent storage of encryption master key if not provided via environment.
 */

import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { EncryptedSecret } from "@ai-review/core";

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEY_LEN = 64; // 512 bits
const PBKDF2_DIGEST = "sha512";
const SALT_BYTE_LENGTH = 16;

/**
 * Hash a plaintext password with a unique cryptographically secure salt.
 * Returns formatted string: `pbkdf2:100000:<saltHex>:<hashHex>`
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_BYTE_LENGTH);
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(
      password,
      salt,
      PBKDF2_ITERATIONS,
      PBKDF2_KEY_LEN,
      PBKDF2_DIGEST,
      (err, derivedKey) => {
        if (err) return reject(err);
        resolve(
          `pbkdf2:${PBKDF2_ITERATIONS}:${salt.toString("hex")}:${derivedKey.toString("hex")}`
        );
      }
    );
  });
}

/**
 * Verify a plaintext password against a stored hashed password in constant time.
 */
export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  try {
    const parts = storedHash.split(":");
    const iterStr = parts[1];
    const saltHex = parts[2];
    const hashHex = parts[3];
    if (parts.length !== 4 || parts[0] !== "pbkdf2" || !iterStr || !saltHex || !hashHex) {
      return false;
    }
    const iterations = parseInt(iterStr, 10);
    const salt = Buffer.from(saltHex, "hex");
    const originalHash = Buffer.from(hashHex, "hex");

    return new Promise((resolve) => {
      crypto.pbkdf2(
        password,
        salt,
        iterations,
        originalHash.length,
        PBKDF2_DIGEST,
        (err, derivedKey) => {
          if (err) return resolve(false);
          if (derivedKey.length !== originalHash.length) return resolve(false);
          resolve(crypto.timingSafeEqual(derivedKey, originalHash));
        }
      );
    });
  } catch {
    return false;
  }
}

/**
 * Generate a high-entropy 256-bit cryptographically secure session token.
 */
export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

let cachedMasterKey: Buffer | null = null;

/**
 * Get or initialize the master AES-256 encryption key.
 * If CREDENTIAL_ENCRYPTION_KEY env var is set, uses it (hashed to 32 bytes).
 * Otherwise loads or creates `./.data/security.key`.
 */
export async function getMasterEncryptionKey(storageDir = "./.data"): Promise<Buffer> {
  if (cachedMasterKey) return cachedMasterKey;

  if (process.env.CREDENTIAL_ENCRYPTION_KEY) {
    cachedMasterKey = crypto
      .createHash("sha256")
      .update(process.env.CREDENTIAL_ENCRYPTION_KEY)
      .digest();
    return cachedMasterKey;
  }

  const keyFilePath = path.resolve(storageDir, "security.key");
  try {
    const existing = await fs.readFile(keyFilePath);
    if (existing.length === 32) {
      cachedMasterKey = existing;
      return cachedMasterKey;
    }
  } catch {
    // Key file does not exist, generate and persist
  }

  const newKey = crypto.randomBytes(32);
  try {
    await fs.mkdir(path.resolve(storageDir), { recursive: true });
    await fs.writeFile(keyFilePath, newKey, { mode: 0o600 });
  } catch (err) {
    console.warn("Failed to persist security.key, continuing in-memory:", err);
  }

  cachedMasterKey = newKey;
  return cachedMasterKey;
}

/**
 * Encrypt arbitrary sensitive plaintext using AES-256-GCM.
 */
export async function encryptSecret(
  plaintext: string,
  storageDir = "./.data"
): Promise<EncryptedSecret> {
  const masterKey = await getMasterEncryptionKey(storageDir);
  const iv = crypto.randomBytes(12); // Standard 96-bit IV for GCM
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    encryptedData: encrypted.toString("hex"),
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
  };
}

/**
 * Decrypt an AES-256-GCM payload with authenticated tag verification.
 */
export async function decryptSecret(
  secret: EncryptedSecret,
  storageDir = "./.data"
): Promise<string> {
  const masterKey = await getMasterEncryptionKey(storageDir);
  const iv = Buffer.from(secret.iv, "hex");
  const tag = Buffer.from(secret.tag, "hex");
  const encryptedText = Buffer.from(secret.encryptedData, "hex");

  const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(encryptedText),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

/**
 * Format a token for display so users can see connected state without exposing the secret.
 * Example: `ghp_1234567890abcdef` -> `ghp_••••••••cdef`
 */
export function maskToken(token: string): string {
  if (!token) return "";
  const trimmed = token.trim();
  if (trimmed.length <= 8) {
    return "••••••••";
  }
  const prefix = trimmed.slice(0, 4);
  const suffix = trimmed.slice(-4);
  return `${prefix}••••••••${suffix}`;
}
