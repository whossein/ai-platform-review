/**
 * Publish handler — Publish review issues to GitLab/GitHub as inline discussions.
 *
 * Takes a Merge Request/Pull Request URL and a list of review issues, and publishes
 * them as inline comments on the corresponding platform.
 */

import { buildEffectiveEnv } from "./client-env.js";
import { publishReview } from "@ai-review/git";

export interface PublishRequest {
  readonly diff: string; // MR/PR URL
  readonly issues: readonly any[];
  readonly env?: Record<string, string>;
  readonly options?: {
    approveWhenClean?: boolean;
    dryRun?: boolean;
  };
}

export interface PublishResponse {
  success: boolean;
  result?: any;
  error?: string;
}

export async function publishHandler(
  request: PublishRequest
): Promise<PublishResponse> {
  const { diff, issues, env = {}, options = {} } = request;

  if (!diff || typeof diff !== "string") {
    throw new Error('field "diff" (Merge Request URL) is required');
  }
  if (!issues || !Array.isArray(issues)) {
    throw new Error('field "issues" is required');
  }

  const mergedEnv = buildEffectiveEnv(process.env, env, { targetUrl: diff });
  const result = await publishReview({
    diffUrl: diff,
    issues,
    env: mergedEnv,
    options: {
      approveWhenClean: options.approveWhenClean ?? true,
      dryRun: options.dryRun ?? false,
    },
  });

  if (result.ok) {
    return {
      success: true,
      result: result.value,
    };
  } else {
    const msg = result.error.message || "Failed to publish";
    throw new Error(msg);
  }
}
