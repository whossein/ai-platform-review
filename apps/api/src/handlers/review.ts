/**
 * Review handler — Execute multi-agent code review pipeline.
 *
 * Accepts a diff string and optional threshold, executes the full review pipeline,
 * automatically detects or links projects, updates persistent project statistics,
 * and returns markdown/JSON reports with issue details and metrics.
 *
 * This handler encapsulates the review logic shared between:
 *  - Root Express server (server.ts)
 *  - Standalone API server (apps/api/src/server.ts)
 */

import { runReview } from "@ai-review/orchestrator";
import { resolveDiffInput, parseDiffToFiles } from "@ai-review/git";
import { providersFromEnv } from "@ai-review/llm";
import type {
  AgentRegistry,
  LLMProvider,
  MemoryStore,
  Project,
} from "@ai-review/core";

export interface ReviewRequest {
  readonly diff: string;
  readonly threshold?: number;
  readonly env?: Record<string, string>;
  readonly selectedSpecialists?: readonly string[];
  readonly memoryStore?: MemoryStore;
  readonly projectId?: string;
  readonly projectName?: string;
  readonly customInstructions?: string;
  /**
   * Called with the changed file paths once the diff is resolved; may return
   * extra structural context (e.g. from the project index) for the reviewers.
   */
  readonly projectContextProvider?: (
    paths: readonly string[],
    context: {
      readonly targetBranch?: string | undefined;
      readonly diff?: string | undefined;
    },
  ) => Promise<string | undefined>;
}

export interface ReviewResponse {
  markdown: string;
  json: any;
  accepted: number;
  total: number;
  issues: readonly any[];
  /** False when no real AI provider is configured: only deterministic rules ran. */
  llmConfigured: boolean;
  /** Specialists that failed (LLM error, bad JSON, budget…); never silently dropped. */
  errors: readonly { agentId: string; message: string }[];
  metrics: {
    cacheHits: number;
    cacheMisses: number;
  };
  project?: Project;
}

export async function reviewHandler(
  request: ReviewRequest,
  agentRegistry: AgentRegistry,
  extraProviders?: readonly LLMProvider[],
  memoryStore?: MemoryStore,
): Promise<ReviewResponse> {
  const {
    diff,
    threshold,
    env = {},
    selectedSpecialists,
    customInstructions,
    projectName,
  } = request;
  const effectiveMemoryStore = memoryStore || request.memoryStore;

  if (!diff || typeof diff !== "string" || diff.trim().length === 0) {
    throw new Error('field "diff" is required');
  }

  const mergedEnv: Record<string, string> = { ...(process.env as Record<string, string>), ...env };
  const rawDiff = await resolveDiffInput(diff, mergedEnv);
  const parsedFiles = parseDiffToFiles(rawDiff);

  let projectContext: string | undefined;
  if (request.projectContextProvider) {
    try {
      // The resolver prefixes MR/PR diffs with a "# Target Branch: <name>" header
      const targetBranch = /^# Target Branch: (\S+)/m.exec(rawDiff)?.[1];
      projectContext = await request.projectContextProvider(
        parsedFiles.map((f) => f.path),
        { targetBranch, diff: rawDiff },
      );
    } catch (err) {
      // Structural context is an enhancement; never fail a review because of it.
      console.warn("Project context unavailable:", err);
    }
  }

  const result = await runReview(
    agentRegistry,
    {
      diff: rawDiff,
      files: parsedFiles,
      ...(threshold !== undefined ? { confidenceThreshold: threshold } : {}),
      env: mergedEnv,
      ...(Array.isArray(selectedSpecialists) ? { selectedSpecialists } : {}),
      ...(effectiveMemoryStore ? { memoryStore: effectiveMemoryStore } : {}),
      ...(customInstructions ? { customInstructions } : {}),
      ...(projectName ? { projectName } : {}),
      ...(projectContext ? { projectContext } : {}),
    },
    extraProviders
  );

  return {
    markdown: result.markdown,
    json: JSON.parse(result.json),
    accepted: result.accepted,
    total: result.total,
    issues: result.issues,
    llmConfigured: providersFromEnv(mergedEnv).length > 0,
    errors: result.errors ?? [],
    metrics: result.metrics,
  };
}
