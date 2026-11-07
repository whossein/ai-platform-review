/**
 * Contributing & Documentation Compliance Skill (Phase 4, ADR-0003).
 *
 * Checks commit message and branch name format when provided. Documentation and
 * changelog requirements are project-specific, so they are left to the reviewer
 * (which reads the project's own guidelines) rather than assumed here.
 */

import type {
  Skill,
  SkillId,
  SkillInput,
  SkillOutput,
  AsyncResult,
} from "@ai-review/core";

export interface ContributingComplianceResult {
  compliant: boolean;
  score: number; // 0..100
  missingRequirements: string[];
  findings: Array<{
    rule: string;
    level: "error" | "warning" | "info";
    message: string;
  }>;
}

export const contributingComplianceSkill: Skill = {
  descriptor: {
    id: "skill.governance.contributing-compliance" as SkillId,
    name: "Contributing & Docs Compliance",
    description:
      "Checks commit message and branch name format when they are provided. Whether docs or a changelog are required is project-specific and left to the reviewer.",
    inputSchema: {
      type: "object",
      properties: {
        diff: { type: "string", description: "Raw unified diff string" },
        files: { type: "array", items: { type: "string" }, description: "List of changed file paths" },
        branchName: { type: "string", description: "Source branch name" },
        commitMessage: { type: "string", description: "Commit message or PR title" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        compliant: { type: "boolean" },
        score: { type: "number" },
        missingRequirements: { type: "array", items: { type: "string" } },
        findings: { type: "array" },
      },
    },
  },
  async execute(input: SkillInput): AsyncResult<SkillOutput> {
    const branchName = input.args.branchName
      ? String(input.args.branchName)
      : undefined;
    const commitMessage = input.args.commitMessage
      ? String(input.args.commitMessage)
      : undefined;

    const missing: string[] = [];
    const findings: ContributingComplianceResult["findings"] = [];

    // 1. Validate conventional commit format if provided
    if (commitMessage) {
      const conventionalPattern =
        /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9_-]+\))?:\s.+/i;
      if (!conventionalPattern.test(commitMessage.trim())) {
        findings.push({
          rule: "git/conventional-commit",
          level: "info",
          message: `Commit/PR title "${commitMessage}" does not follow Conventional Commits format (e.g. "feat(auth): add token validation").`,
        });
      }
    }

    // 2. Validate branch naming convention if provided
    if (branchName) {
      const validBranchPattern =
        /^(feature|feat|fix|bugfix|hotfix|chore|docs|release|refactor)\/[a-z0-9_-]+$/i;
      if (
        !validBranchPattern.test(branchName) &&
        !["main", "master", "develop"].includes(branchName)
      ) {
        findings.push({
          rule: "git/branch-naming",
          level: "info",
          message: `Branch name "${branchName}" does not follow standard prefix pattern (e.g. "feat/...", "fix/...").`,
        });
      }
    }

    const errorsCount = findings.filter((f) => f.level === "error").length;
    const warningsCount = findings.filter((f) => f.level === "warning").length;
    const penalty = errorsCount * 30 + warningsCount * 15;
    const score = Math.max(0, 100 - penalty);

    const result: ContributingComplianceResult = {
      compliant: errorsCount === 0 && missing.length === 0,
      score,
      missingRequirements: missing,
      findings,
    };

    return {
      ok: true,
      value: {
        result: result as unknown as Record<string, unknown>,
      },
    };
  },
};
