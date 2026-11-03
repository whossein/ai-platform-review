/**
 * Diff & Change Risk Analysis Skill (Phase 4, ADR-0003).
 *
 * Analyzes raw diffs or changed files, computing churn metrics, file type breakdown,
 * and risk levels based on sensitive file paths (auth, db migrations, secrets, configs).
 */

import type {
  Skill,
  SkillId,
  SkillInput,
  SkillOutput,
  AsyncResult,
  ContextSlice,
} from "@ai-review/core";

export interface DiffMetrics {
  readonly filesChanged: number;
  readonly linesAdded: number;
  readonly linesDeleted: number;
  readonly totalChurn: number;
  readonly sensitiveFiles: readonly string[];
  readonly riskLevel: "low" | "medium" | "high";
  readonly summary: string;
}

const SENSITIVE_PATTERNS = [
  /auth/i,
  /password/i,
  /migration/i,
  /security/i,
  /\.env/i,
  /docker-compose/i,
  /k8s/i,
  /ci\.ya?ml/i,
  /gitlab-ci/i,
  /github\/workflows/i,
  /secret/i,
  /payment/i,
];

/** Line-number gutter (6 chars) the orchestrator prepends to in-hunk lines. */
const GUTTER_RE = /^(?: {0,5}\d+| {6})(?=[+\- ])/;

export const diffAnalysisSkill: Skill = {
  descriptor: {
    id: "skill.diff.analyze" as SkillId,
    name: "Analyze Diff & Change Risk",
    description:
      "Calculates lines added/deleted, file churn, and risk level based on modifications to sensitive architectural paths.",
    inputSchema: {
      type: "object",
      properties: {
        diff: { type: "string", description: "Raw unified diff string" },
        slice: { type: "object", description: "Optional ContextSlice object" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        filesChanged: { type: "number" },
        linesAdded: { type: "number" },
        linesDeleted: { type: "number" },
        totalChurn: { type: "number" },
        sensitiveFiles: { type: "array", items: { type: "string" } },
        riskLevel: { type: "string" },
        summary: { type: "string" },
      },
    },
  },
  async execute(input: SkillInput): AsyncResult<SkillOutput> {
    const rawDiff = String(input.args.diff ?? "");
    const slice = input.args.slice as ContextSlice | undefined;

    let linesAdded = 0;
    let linesDeleted = 0;
    const changedFiles = new Set<string>();

    if (rawDiff.length > 0) {
      const lines = rawDiff.split("\n");
      for (const rawLine of lines) {
        // Tolerate the annotated diff format: drop the line-number gutter.
        const gutter = GUTTER_RE.exec(rawLine);
        const line =
          gutter && gutter[0].length === 6 ? rawLine.slice(6) : rawLine;
        if (line.startsWith("+++ b/")) {
          changedFiles.add(line.slice(6));
        } else if (line.startsWith("+") && !line.startsWith("+++")) {
          linesAdded++;
        } else if (line.startsWith("-") && !line.startsWith("---")) {
          linesDeleted++;
        }
      }
    }

    if (slice?.files) {
      for (const f of slice.files) {
        if (f.changed) changedFiles.add(f.path);
      }
    }

    const sensitiveFiles: string[] = [];
    for (const f of changedFiles) {
      if (SENSITIVE_PATTERNS.some((pat) => pat.test(f))) {
        sensitiveFiles.push(f);
      }
    }

    const totalChurn = linesAdded + linesDeleted;
    let riskLevel: "low" | "medium" | "high" = "low";

    if (sensitiveFiles.length > 0 || totalChurn > 800) {
      riskLevel = "high";
    } else if (totalChurn > 200 || changedFiles.size > 8) {
      riskLevel = "medium";
    }

    const summary = `${changedFiles.size} file(s) changed (+${linesAdded}, -${linesDeleted}). Risk: ${riskLevel}.`;

    const metrics: DiffMetrics = {
      filesChanged: changedFiles.size,
      linesAdded,
      linesDeleted,
      totalChurn,
      sensitiveFiles,
      riskLevel,
      summary,
    };

    return {
      ok: true,
      value: {
        result: metrics as unknown as Record<string, unknown>,
      },
    };
  },
};
