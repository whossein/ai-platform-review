/**
 * Rate-limit helpers: parse provider hints, compute bounded waits, and cap
 * in-flight requests per provider. Pure and clock-free so tests inject time.
 */

/** Lowest wait we ever honor, so a `Retry-After: 0` cannot spin. */
const MIN_WAIT_MS = 500;

/** Parses `49s`, `1m30s`, `200ms`, `1h2m3.5s` or a bare number (seconds) to ms. */
export function parseDurationMs(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  const text = value.trim().toLowerCase();
  if (!text) return undefined;
  if (/^\d+(\.\d+)?$/.test(text)) return Math.round(Number(text) * 1000);
  const re = /(\d+(?:\.\d+)?)(ms|h|m|s)/g;
  const unit = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 } as const;
  let total = 0;
  let consumed = 0;
  for (const m of text.matchAll(re)) {
    if (m.index !== consumed) return undefined;
    total += Number(m[1]) * unit[m[2] as keyof typeof unit];
    consumed = m.index + m[0].length;
  }
  if (consumed === 0 || consumed !== text.length) return undefined;
  return Math.round(total);
}

/** `Retry-After`: delta-seconds or an HTTP date. */
export function parseRetryAfterMs(
  value: string | null | undefined,
  now: number = Date.now(),
): number | undefined {
  if (value === null || value === undefined) return undefined;
  const text = value.trim();
  if (!text) return undefined;
  if (/^\d+(\.\d+)?$/.test(text)) return Math.round(Number(text) * 1000);
  if (/^[A-Za-z]{3},/.test(text)) {
    const at = Date.parse(text);
    if (Number.isFinite(at)) return Math.max(0, at - now);
  }
  return undefined;
}

/**
 * How long the provider asked us to wait, from a 429 response's headers.
 * `Retry-After` wins; otherwise the `x-ratelimit-reset-*` of the exhausted
 * bucket (or the longest one if none says it is exhausted). `undefined` when
 * no usable hint exists, so the caller backs off exponentially.
 */
export function rateLimitWaitMs(
  headers: { get(name: string): string | null } | undefined,
  now: number = Date.now(),
): number | undefined {
  if (!headers || typeof headers.get !== "function") return undefined;
  const retryAfter = parseRetryAfterMs(headers.get("retry-after"), now);
  if (retryAfter !== undefined) return Math.max(MIN_WAIT_MS, retryAfter);

  const buckets = (["requests", "tokens"] as const).flatMap((kind) => {
    const reset = parseDurationMs(headers.get(`x-ratelimit-reset-${kind}`));
    if (reset === undefined) return [];
    const remaining = headers.get(`x-ratelimit-remaining-${kind}`);
    return [{ reset, exhausted: remaining !== null && Number(remaining) === 0 }];
  });
  if (buckets.length === 0) return undefined;
  const exhausted = buckets.filter((b) => b.exhausted);
  const pool = exhausted.length > 0 ? exhausted : buckets;
  return Math.max(MIN_WAIT_MS, ...pool.map((b) => b.reset));
}

export interface WaitPolicy {
  readonly maxWaitMs: number;
  readonly baseBackoffMs: number;
  readonly random: () => number;
}

/**
 * Wait before round `round` (1-based). Uses the provider hint when present,
 * else exponential backoff. Never exceeds `maxWaitMs`. Jitter (up to 20%)
 * spreads parallel specialists: added on top of the hint, or taken off the cap
 * when the hint was capped, so they never all wake at the same instant.
 */
export function computeWaitMs(
  hintMs: number | undefined,
  round: number,
  policy: WaitPolicy,
): number {
  const base = hintMs ?? policy.baseBackoffMs * 2 ** (round - 1);
  const r = Math.min(1, Math.max(0, policy.random()));
  if (base >= policy.maxWaitMs) {
    return Math.round(policy.maxWaitMs * (1 - 0.2 * r));
  }
  return Math.round(Math.min(policy.maxWaitMs, base * (1 + 0.2 * r)));
}

/** FIFO counting semaphore. */
export class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];
  constructor(private readonly limit: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    } else {
      this.active++;
    }
    try {
      return await task();
    } finally {
      const next = this.queue.shift();
      if (next) next(); // hand the slot over without releasing it
      else this.active--;
    }
  }
}

export const DEFAULT_MAX_CONCURRENCY = 4;

/** `AI_REVIEW_LLM_MAX_CONCURRENCY`: positive integer, else the default. */
export function resolveMaxConcurrency(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env["AI_REVIEW_LLM_MAX_CONCURRENCY"]?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_MAX_CONCURRENCY;
}
