/**
 * Secret and token redaction utilities for @ai-review/project-index.
 *
 * Guarantees that GitLab/GitHub personal access tokens, Bearer tokens, URL
 * credentials, and explicit secret strings never leak into persisted snapshots,
 * job.json files, or error messages.
 */

const COMMON_SECRET_PATTERNS: readonly RegExp[] = [
  // GitLab PAT (glpat-...)
  /\bglpat-[A-Za-z0-9_\-=]{8,}\b/g,
  // GitHub tokens (ghp_, gho_, ghu_, ghs_, ghr_, github_pat_)
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{8,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{10,}\b/g,
  // Authorization / Private-Token header values in diagnostic text
  /((?:authorization|private-token)\s*[:=]\s*(?:bearer\s+|token\s+)?)([^\s"',;]+)/gi,
  // URL userinfo credentials e.g. https://oauth2:secret@gitlab.com/
  /(\bhttps?:\/\/[^/\s:@]+:)([^@\s/]+)(@)/gi,
  // Query parameter tokens e.g. ?private_token=xyz or &access_token=xyz
  /([?&](?:private_token|access_token|token)=)([^&\s"']+)/gi,
];

/**
 * Scrubs any known secret values and common token formats from an arbitrary string.
 */
export function redactSecrets(
  input: string,
  explicitSecrets: readonly (string | undefined)[] = [],
): string {
  if (!input) return input;
  let sanitized = input;

  for (const secret of explicitSecrets) {
    if (secret && secret.trim().length >= 4) {
      const trimmed = secret.trim();
      sanitized = sanitized.split(trimmed).join("[REDACTED]");
      const encoded = encodeURIComponent(trimmed);
      if (encoded !== trimmed) {
        sanitized = sanitized.split(encoded).join("[REDACTED]");
      }
    }
  }

  sanitized = sanitized.replace(COMMON_SECRET_PATTERNS[0]!, "[REDACTED]");
  sanitized = sanitized.replace(COMMON_SECRET_PATTERNS[1]!, "[REDACTED]");
  sanitized = sanitized.replace(COMMON_SECRET_PATTERNS[2]!, "[REDACTED]");
  sanitized = sanitized.replace(COMMON_SECRET_PATTERNS[3]!, "$1[REDACTED]");
  sanitized = sanitized.replace(COMMON_SECRET_PATTERNS[4]!, "$1[REDACTED]$3");
  sanitized = sanitized.replace(COMMON_SECRET_PATTERNS[5]!, "$1[REDACTED]");

  return sanitized;
}
