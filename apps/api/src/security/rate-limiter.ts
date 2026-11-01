/**
 * In-memory sliding-window Rate Limiter for authentication endpoints.
 *
 * Prevents credential stuffing and brute-force attacks against login and setup routes.
 */

interface RateLimitRecord {
  attempts: number;
  lastAttempt: number;
  blockedUntil?: number;
}

export class RateLimiter {
  private records: Map<string, RateLimitRecord> = new Map();
  private readonly maxAttempts: number;
  private readonly windowMs: number;
  private readonly blockDurationMs: number;

  constructor(
    maxAttempts = 5,
    windowMs = 5 * 60 * 1000, // 5 minutes
    blockDurationMs = 10 * 60 * 1000 // 10 minutes
  ) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
    this.blockDurationMs = blockDurationMs;

    // Prune stale records every 5 minutes
    setInterval(() => this.cleanup(), 5 * 60 * 1000).unref();
  }

  isBlocked(key: string): { blocked: boolean; retryAfterSeconds?: number } {
    const record = this.records.get(key);
    if (!record) return { blocked: false };

    const now = Date.now();
    if (record.blockedUntil && record.blockedUntil > now) {
      const retryAfterSeconds = Math.ceil((record.blockedUntil - now) / 1000);
      return { blocked: true, retryAfterSeconds };
    }

    if (now - record.lastAttempt > this.windowMs) {
      this.records.delete(key);
      return { blocked: false };
    }

    return { blocked: false };
  }

  recordFailure(key: string): { blocked: boolean; retryAfterSeconds?: number } {
    const now = Date.now();
    let record = this.records.get(key);

    if (!record || now - record.lastAttempt > this.windowMs) {
      record = { attempts: 1, lastAttempt: now };
    } else {
      record.attempts += 1;
      record.lastAttempt = now;
    }

    if (record.attempts >= this.maxAttempts) {
      record.blockedUntil = now + this.blockDurationMs;
      this.records.set(key, record);
      return {
        blocked: true,
        retryAfterSeconds: Math.ceil(this.blockDurationMs / 1000),
      };
    }

    this.records.set(key, record);
    return { blocked: false };
  }

  recordSuccess(key: string): void {
    this.records.delete(key);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, record] of this.records.entries()) {
      if (
        (!record.blockedUntil || record.blockedUntil < now) &&
        now - record.lastAttempt > this.windowMs
      ) {
        this.records.delete(key);
      }
    }
  }
}
