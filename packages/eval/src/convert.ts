import type { Issue } from "@ai-review/core";
import type { CandidateFinding } from "./types.js";

/** Lifts a pipeline `Issue` (rule-engine or LLM) into the evaluator's shape. */
export function issueToCandidate(
  issue: Pick<
    Issue,
    "title" | "description" | "reason" | "location" | "category" | "severity"
  > & { id: string; suggestion?: string | { readonly description: string } | undefined; producedBy?: string | undefined },
  index: number,
  accepted = true,
): CandidateFinding {
  const { file, line, endLine } = issue.location;
  const suggestion =
    typeof issue.suggestion === "string"
      ? issue.suggestion
      : issue.suggestion?.description;
  return {
    // Fingerprints can collide across rules; the index keeps ids unique per case.
    id: `${issue.id}#${index}`,
    title: issue.title,
    description: issue.description,
    reason: issue.reason,
    ...(suggestion ? { suggestion } : {}),
    location: {
      file,
      ...(line !== undefined ? { line } : {}),
      ...(endLine !== undefined ? { endLine } : {}),
    },
    category: issue.category,
    severity: issue.severity,
    accepted,
    ...(issue.producedBy ? { producedBy: String(issue.producedBy) } : {}),
  };
}
