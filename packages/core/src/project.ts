/**
 * Project entity and repository registry contracts.
 *
 * A Project is a first-class entity representing a Git repository.
 * The canonical unique identity of a Project is based on:
 *   gitHost + repositoryPath
 *
 * Projects can be created manually or automatically when a Merge Request
 * / Pull Request URL is submitted.
 */

import type { IsoTimestamp, ProjectId } from "./ids.js";

/**
 * Normalized repository identity parsed from a repository URL or MR/PR URL.
 * Two URLs refer to the same repository if and only if their identityKey matches:
 *   `${gitHost.toLowerCase()}/${repositoryPath.toLowerCase()}`
 */
export interface ProjectRepositoryIdentity {
  /**
   * Host of the git instance, including port if non-standard.
   * e.g. "gitlab.company.com", "gitlab.com", "github.com"
   */
  readonly gitHost: string;

  /**
   * Normalized repository path relative to the host, without leading/trailing slashes
   * and without `.git` extension or MR/PR subpaths.
   * e.g. "frontend/storefront-pwa"
   */
  readonly repositoryPath: string;

  /**
   * Project name (usually the final segment of the repository path, or user-provided).
   * e.g. "storefront-pwa"
   */
  readonly name: string;

  /**
   * Namespace path (all segments preceding the project name).
   * e.g. "frontend"
   */
  readonly namespace: string;

  /**
   * Canonical full HTTP/HTTPS repository URL.
   * e.g. "https://gitlab.company.com/frontend/storefront-pwa"
   */
  readonly repositoryUrl: string;

  /**
   * Case-insensitive composite unique key: `${gitHost.toLowerCase()}/${repositoryPath.toLowerCase()}`
   */
  readonly identityKey: string;
}

/**
 * First-class Project entity in the system.
 */
export interface Project {
  readonly id: ProjectId;
  readonly name: string;
  readonly repositoryUrl: string;
  readonly gitHost: string;
  readonly repositoryPath: string;
  readonly namespace: string;
  /** Optional project summary or description. */
  readonly description?: string | undefined;
  /**
   * Project-specific system instructions, guidelines, and rules passed to AI
   * specialist reviewers during code review for this project.
   */
  readonly customInstructions?: string | undefined;
  /**
   * AI-condensed version of `customInstructions`, sent to reviewers instead of
   * the full text to save tokens. Only valid while `compactSourceHash` matches
   * the hash of the current `customInstructions`.
   */
  readonly compactInstructions?: string | undefined;
  readonly compactSourceHash?: string | undefined;
  /** Optional default Git branch (e.g., "main", "master") for indexing. */
  readonly defaultBranch?: string | undefined;
  /** Optional local filesystem path when indexing a local checkout. */
  readonly localPath?: string | undefined;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

/** Developer (MR/PR author) as reported by the git provider. */
export interface MergeRequestAuthor {
  /** Provider login, e.g. GitLab/GitHub username. */
  readonly username: string;
  /** Display name when the provider exposes one. */
  readonly name?: string | undefined;
  readonly avatarUrl?: string | undefined;
  readonly profileUrl?: string | undefined;
}

/** Task-completion grade (0-100) a human reviewer gave to an MR's author. */
export interface MergeRequestGrade {
  readonly score: number;
  readonly note?: string | undefined;
  readonly gradedById: string;
  readonly gradedByName: string;
  readonly gradedAt: IsoTimestamp;
}

/** Grade proposed by the system from the latest review, with a short reason. */
export interface MergeRequestSuggestedGrade {
  readonly score: number;
  readonly reason: string;
  readonly reviewId: string;
  readonly computedAt: IsoTimestamp;
}

/** Estimated likelihood that the MR's code was largely AI-generated. */
export interface MergeRequestAiUsage {
  /** 0-100, rounded. An estimate, not proof. */
  readonly percent: number;
  readonly level: "low" | "medium" | "high";
  /** Short reasons: rule signals first, then the AI judge's. */
  readonly reasons: readonly string[];
  readonly method: "rules+ai" | "rules";
  readonly rulesScore: number;
  readonly aiScore?: number | undefined;
  readonly computedAt: IsoTimestamp;
  readonly computedByName: string;
}

/**
 * A developer seen as an MR/PR author. This is a registry of git identities,
 * deliberately separate from app login users (no account is created for them).
 */
export interface ProjectDeveloper {
  /** `${gitHost}/${username}` lowercased. */
  readonly id: string;
  readonly gitHost: string;
  readonly username: string;
  readonly name?: string | undefined;
  readonly avatarUrl?: string | undefined;
  readonly profileUrl?: string | undefined;
  /** App user this developer was matched to (by username or name), if any. */
  readonly linkedUserId?: string | undefined;
  readonly firstSeenAt: IsoTimestamp;
}

/**
 * Merge Request / Pull Request associated with a Project.
 */
export interface ProjectMergeRequest {
  readonly id: string;
  readonly projectId: ProjectId;
  readonly mrNumber: string;
  readonly url: string;
  readonly title?: string | undefined;
  readonly sourceBranch?: string | undefined;
  readonly targetBranch?: string | undefined;
  readonly author?: MergeRequestAuthor | undefined;
  readonly grade?: MergeRequestGrade | undefined;
  readonly suggestedGrade?: MergeRequestSuggestedGrade | undefined;
  readonly aiUsage?: MergeRequestAiUsage | undefined;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

/**
 * Review summary associated with a Project.
 */
export interface ProjectReviewRecord {
  readonly id: string;
  readonly projectId: ProjectId;
  readonly mergeRequestId?: string | undefined;
  readonly timestamp: number;
  readonly inputMode: string;
  readonly target: string;
  readonly model: string;
  readonly score?: number | undefined;
  readonly issuesCount: number;
  readonly acceptedCount: number;
  readonly criticalCount: number;
  readonly highCount: number;
  readonly summaryMarkdown?: string | undefined;
}

/**
 * Aggregated project model with statistics.
 */
export interface ProjectWithStats extends Project {
  readonly mergeRequestCount: number;
  readonly reviewCount: number;
  readonly latestReview?: ProjectReviewRecord | undefined;
  readonly averageScore?: number | undefined;
}
