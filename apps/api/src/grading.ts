/**
 * Suggested task-completion grade (0-10) for a merge request, derived from its
 * latest review. Deterministic and explainable: the reason lists exactly
 * what pulled the score down so a human reviewer can accept or override it.
 */

const SEVERITY_PENALTY = { critical: 25, high: 15, medium: 6, low: 2 } as const;
type Severity = keyof typeof SEVERITY_PENALTY;

export interface SuggestedGrade {
  readonly score: number;
  readonly reason: string;
}

export function suggestGrade(issues: readonly { severity?: string; accepted?: boolean }[]): SuggestedGrade {
  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const issue of issues) {
    if (!issue.accepted) continue;
    const sev = issue.severity as Severity;
    if (sev in counts) counts[sev]++;
  }

  let deduction = 0;
  const parts: string[] = [];
  for (const sev of ["critical", "high", "medium", "low"] as const) {
    if (counts[sev] === 0) continue;
    deduction += counts[sev] * SEVERITY_PENALTY[sev];
    parts.push(`${counts[sev]} ${sev}`);
  }

  // Penalties are in points of 100; the grade scale is 0-10.
  const score = Math.max(1, Math.min(10, Math.round((100 - deduction) / 10)));
  const reason =
    parts.length === 0
      ? "No accepted issues in the latest review."
      : `Latest review has ${parts.join(", ")} accepted issue${parts.length === 1 && Object.values(counts).reduce((a, b) => a + b, 0) === 1 ? "" : "s"} (-${Math.round(deduction) / 10}).`;
  return { score, reason };
}
