/**
 * Prompt management contracts.
 *
 * Prompts are versioned assets (ADR-0007/0008): versioning enables prompt
 * caching, response-cache invalidation, and regression testing. Rendering is
 * deterministic given a prompt id, version, and variables.
 */

import type { PromptId } from "./ids.js";
import type { AsyncResult } from "./result.js";

/** A versioned prompt template. Bumping `version` invalidates prompt caches. */
export interface PromptTemplate {
  readonly id: PromptId;
  readonly version: number;
  readonly description: string;
  /** Template body with named `{{variables}}`. */
  readonly template: string;
  /** Variable names the template expects, for validation. */
  readonly variables: readonly string[];
}

/** A rendered prompt ready to send, plus the identity used for cache keys. */
export interface RenderedPrompt {
  readonly id: PromptId;
  readonly version: number;
  readonly text: string;
}

export interface PromptRegistry {
  register(template: PromptTemplate): void;
  get(id: PromptId, version?: number): PromptTemplate | undefined;
  list(): readonly PromptTemplate[];
}

/** Deterministically renders a template with variables. Lives in `prompts`. */
export interface PromptRenderer {
  render(
    id: PromptId,
    variables: Readonly<Record<string, string>>,
    version?: number,
  ): AsyncResult<RenderedPrompt>;
}

/**
 * Wraps untrusted text (diff, repository files, tool output) in an XML-style
 * block the model is told to treat as data only. Any opening/closing tag of the
 * same name inside the text is defanged so the content cannot close the block
 * early and smuggle instructions outside it.
 */
export function untrustedBlock(tag: string, text: string): string {
  const defanged = text.replace(
    new RegExp(`<(/?)${tag}(?=[\\s>/])`, "gi"),
    (_m, slash: string) => `<${slash}${tag}_`,
  );
  return `<${tag}>\n${defanged}\n</${tag}>`;
}
