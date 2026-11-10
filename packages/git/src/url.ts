/**
 * Merge/Pull request URL parsing.
 *
 * Resolves the `merge_request_url` / `pull_request_url` input methods into a
 * provider-agnostic `ChangeRequestRef`. GitLab today; the same function grows
 * GitHub/Azure/Bitbucket branches without changing callers.
 */

import type { ChangeRequestRef, ProjectRepositoryIdentity } from "@ai-review/core";
import { trimTrailingSlashes } from "@ai-review/shared";

/**
 * Parses a GitLab MR URL into a `ChangeRequestRef`.
 *
 * Example:
 *   https://gitlab.example.com/group/sub/project/-/merge_requests/42
 *   → { provider: 'gitlab', projectId: 'group/sub/project', id: '42' }
 *
 * GitLab project ids are the full namespace path (URL-encoded when calling the
 * API), so we keep the path as-is here.
 */
export function parseGitLabMrUrl(url: string): ChangeRequestRef | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  // Path looks like: /<namespace/path>/-/merge_requests/<iid>
  const marker = "/-/merge_requests/";
  const idx = parsed.pathname.indexOf(marker);
  if (idx === -1) return undefined;

  const projectId = parsed.pathname.slice(1, idx);
  const rest = parsed.pathname.slice(idx + marker.length);
  const id = rest.split("/")[0] ?? "";
  if (!projectId || !id) return undefined;

  return { provider: "gitlab", projectId, id };
}

/**
 * Extracts the GitLab instance base URL (origin) from an MR URL.
 *
 * This is what makes **self-hosted** GitLab work with zero extra configuration:
 * given any internal URL (any host, port, or scheme), the API base is derived
 * automatically, so the caller only needs to supply an access token.
 *
 * Example:
 *   https://git.company.internal:8443/team/app/-/merge_requests/7
 *   → https://git.company.internal:8443
 */
export function gitlabBaseUrlFromMrUrl(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/**
 * Parses a GitHub pull-request URL into a `ChangeRequestRef`.
 *
 * Example:
 *   https://github.com/owner/repo/pull/123
 *   → { provider: 'github', projectId: 'owner/repo', id: '123' }
 *
 * Also works for GitHub Enterprise (any host) since we only match on the
 * `/pull/<number>` path segment, not the origin.
 */
export function parseGitHubPrUrl(url: string): ChangeRequestRef | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  // Path looks like: /<owner>/<repo>/pull/<number>
  const match = /^\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(parsed.pathname);
  if (!match) return undefined;
  const [, projectId, id] = match;
  if (!projectId || !id) return undefined;
  return { provider: "github", projectId, id };
}

/**
 * Resolves any supported change-request URL (GitLab MR or GitHub PR) into a
 * provider-agnostic `ChangeRequestRef`, so callers accept one flag for both.
 * Azure DevOps / Bitbucket branches slot in here without changing callers.
 */
export function parseChangeRequestUrl(
  url: string,
): ChangeRequestRef | undefined {
  return parseGitLabMrUrl(url) ?? parseGitHubPrUrl(url);
}

/** Extracts the instance base URL (origin) from any change-request URL. */
export function baseUrlFromChangeRequestUrl(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/**
 * Extracts and normalizes repository identity from any repository or change-request URL.
 * Handles self-hosted GitLab, GitLab.com, GitHub, GitHub Enterprise, Bitbucket, Azure,
 * SSH git formats, and normalizes out .git suffixes, trailing slashes, and MR/PR subpaths.
 */
export function extractRepositoryIdentity(
  input: string,
): ProjectRepositoryIdentity | undefined {
  if (!input || typeof input !== "string") return undefined;
  const trimmed = input.trim();
  if (!trimmed) return undefined;

  let protocol = "https:";
  let host = "";
  let rawPath = "";

  // Handle SSH format e.g. git@gitlab.com:front-end/pwa/app.git
  const sshMatch = /^git@([^:]+):(.+)$/.exec(trimmed);
  if (sshMatch && sshMatch[1] && sshMatch[2]) {
    host = sshMatch[1];
    rawPath = "/" + sshMatch[2];
  } else {
    try {
      const urlToParse = /^[a-zA-Z]+:\/\//.test(trimmed)
        ? trimmed
        : `https://${trimmed}`;
      const parsed = new URL(urlToParse);
      protocol = parsed.protocol;
      host = parsed.host; // host includes port if present (e.g. host:8443)
      rawPath = parsed.pathname;
    } catch {
      return undefined;
    }
  }

  if (!host) return undefined;

  let cleanPath = rawPath;

  // Strip GitLab MR subpaths: /-/merge_requests/123 or /merge_requests/123
  const glMrMatch = cleanPath.indexOf("/-/merge_requests/");
  if (glMrMatch !== -1) {
    cleanPath = cleanPath.substring(0, glMrMatch);
  } else {
    const glOldMrMatch = cleanPath.indexOf("/merge_requests/");
    if (glOldMrMatch !== -1) {
      cleanPath = cleanPath.substring(0, glOldMrMatch);
    }
  }

  // Strip GitHub PR subpaths: /pull/123 or /pulls
  const ghPullMatch = cleanPath.search(/\/pull\/\d+/);
  if (ghPullMatch !== -1) {
    cleanPath = cleanPath.substring(0, ghPullMatch);
  } else {
    const ghPullsMatch = cleanPath.search(/\/pulls(?:\/|$)/);
    if (ghPullsMatch !== -1) {
      cleanPath = cleanPath.substring(0, ghPullsMatch);
    }
  }

  // Strip tree/blob subpaths: /-/tree/..., /-/blob/..., /tree/..., /blob/...
  const treeMatch = cleanPath.search(/\/(?:-\/)?(?:tree|blob)\//);
  if (treeMatch !== -1) {
    cleanPath = cleanPath.substring(0, treeMatch);
  }

  // Strip commit/commits subpaths if after repo path: /commit/..., /commits/...
  const commitMatch = cleanPath.search(/\/(?:-\/)?(?:commit|commits)\//);
  if (commitMatch !== -1) {
    cleanPath = cleanPath.substring(0, commitMatch);
  }

  // Strip trailing slashes
  cleanPath = trimTrailingSlashes(cleanPath);

  // Strip .git extension
  if (cleanPath.toLowerCase().endsWith(".git")) {
    cleanPath = cleanPath.slice(0, -4);
  }

  // Strip leading slashes
  cleanPath = cleanPath.replace(/^\/+/, "");
  if (!cleanPath) return undefined;

  const segments = cleanPath.split("/").filter(Boolean);
  if (segments.length === 0) return undefined;

  const name = segments[segments.length - 1] ?? "";
  if (!name) return undefined;
  const namespace = segments.slice(0, -1).join("/");
  const gitHost = host.toLowerCase();
  const repositoryPath = cleanPath;
  const canonicalScheme = protocol === "http:" ? "http:" : "https:";
  const repositoryUrl = `${canonicalScheme}//${gitHost}/${repositoryPath}`;
  const identityKey = `${gitHost}/${repositoryPath.toLowerCase()}`;

  return {
    gitHost,
    repositoryPath,
    name,
    namespace,
    repositoryUrl,
    identityKey,
  };
}

/**
 * Checks whether two URLs refer to the exact same repository.
 */
export function isSameRepository(urlA: string, urlB: string): boolean {
  const idA = extractRepositoryIdentity(urlA);
  const idB = extractRepositoryIdentity(urlB);
  if (!idA || !idB) return false;
  return idA.identityKey === idB.identityKey;
}

/**
 * Extracts the merge request or pull request number/id from a URL.
 */
export function extractMergeRequestNumber(url: string): string | undefined {
  const ref = parseChangeRequestUrl(url);
  if (ref) return ref.id;
  const match = /\/(?:merge_requests|pull)\/(\d+)/.exec(url);
  return match ? match[1] : undefined;
}

