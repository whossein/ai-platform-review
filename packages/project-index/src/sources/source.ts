/**
 * Source acquisition contracts and rate-limit-aware HTTP helper for @ai-review/project-index.
 */

import type { HttpClient, HttpRequest, HttpResponse } from "@ai-review/git";
import { redactSecrets } from "../redact.js";

export interface ResolvedRef {
  readonly ref: string;
  readonly commitSha: string;
}

export interface SourceTreeEntry {
  readonly path: string;
  readonly size?: number | undefined;
  readonly gitBlobSha?: string | undefined;
}

export interface RepositorySource {
  readonly kind: "gitlab" | "github" | "local";
  /**
   * Resolves a branch/tag/SHA ref (or default branch if omitted) into a canonical commit SHA.
   */
  resolveRef(
    ref?: string | undefined,
    signal?: AbortSignal | undefined,
  ): Promise<ResolvedRef>;

  /**
   * Lists all blob entries in the repository tree at the given commit SHA.
   */
  listTree(
    commitSha: string,
    signal?: AbortSignal | undefined,
  ): Promise<readonly SourceTreeEntry[]>;

  /**
   * Fetches UTF-8 text content of a single file at the given commit SHA.
   */
  readFile(
    entry: SourceTreeEntry,
    commitSha: string,
    signal?: AbortSignal | undefined,
  ): Promise<string>;
}

export interface RateLimitRetryOptions {
  readonly maxRetries?: number | undefined;
  readonly maxRetryAfterMs?: number | undefined;
  readonly defaultBackoffMs?: number | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly secretsToRedact?: readonly (string | undefined)[] | undefined;
}

export function throwIfAborted(signal?: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const err = new Error("Indexing job was cancelled");
    err.name = "AbortError";
    throw err;
  }
}

export function sleepWithAbort(
  ms: number,
  signal?: AbortSignal | undefined,
): Promise<void> {
  throwIfAborted(signal);
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      const err = new Error("Indexing job was cancelled");
      err.name = "AbortError";
      reject(err);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Parses `Retry-After` or `x-ratelimit-reset` / `ratelimit-reset` headers into milliseconds.
 */
export function computeRetryDelayMs(
  headers: Readonly<Record<string, string>> | undefined,
  attempt: number,
  defaultBackoffMs: number,
  maxRetryAfterMs: number,
): number {
  if (headers) {
    const retryAfter =
      headers["retry-after"] ?? headers["Retry-After"] ?? undefined;
    if (retryAfter !== undefined) {
      const asSeconds = Number(retryAfter.trim());
      if (Number.isFinite(asSeconds) && asSeconds >= 0) {
        return Math.min(Math.ceil(asSeconds * 1000), maxRetryAfterMs);
      }
      const dateMs = Date.parse(retryAfter);
      if (Number.isFinite(dateMs)) {
        const delta = Math.max(0, dateMs - Date.now());
        return Math.min(delta, maxRetryAfterMs);
      }
    }

    const rateReset =
      headers["ratelimit-reset"] ??
      headers["x-ratelimit-reset"] ??
      undefined;
    if (rateReset !== undefined) {
      const resetSec = Number(rateReset.trim());
      if (Number.isFinite(resetSec) && resetSec > 0) {
        // Could be epoch seconds or delta seconds
        const deltaMs =
          resetSec > 1_000_000_000
            ? Math.max(0, resetSec * 1000 - Date.now())
            : resetSec * 1000;
        return Math.min(Math.ceil(deltaMs), maxRetryAfterMs);
      }
    }
  }

  const exp = defaultBackoffMs * Math.pow(2, attempt);
  return Math.min(exp, maxRetryAfterMs);
}

/**
 * Executes an HTTP request via `HttpClient`, automatically honoring HTTP 429 / 503
 * rate-limit responses and scrubbing credentials from any thrown error.
 */
export async function sendWithRateLimitRetry(
  http: HttpClient,
  req: HttpRequest,
  opts?: RateLimitRetryOptions,
): Promise<HttpResponse> {
  const maxRetries = opts?.maxRetries ?? 4;
  const maxRetryAfterMs = opts?.maxRetryAfterMs ?? 60_000;
  const defaultBackoffMs = opts?.defaultBackoffMs ?? 250;
  const secrets = opts?.secretsToRedact ?? [];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    throwIfAborted(opts?.signal);
    const result = await http.send(req);
    throwIfAborted(opts?.signal);

    if (!result.ok) {
      const safeMsg = redactSecrets(result.error.message, secrets);
      throw new Error(`HTTP transport error (${result.error.code}): ${safeMsg}`);
    }

    const response = result.value;
    if (
      (response.status === 429 || response.status === 503) &&
      attempt < maxRetries
    ) {
      const delayMs = computeRetryDelayMs(
        response.headers,
        attempt,
        defaultBackoffMs,
        maxRetryAfterMs,
      );
      await sleepWithAbort(delayMs, opts?.signal);
      continue;
    }

    return response;
  }

  throw new Error(
    redactSecrets(`Request to ${req.url} exceeded rate-limit retries`, secrets),
  );
}
