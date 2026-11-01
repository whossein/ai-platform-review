import type {
  CandidateFinding,
  ExpectedFinding,
  AntiFinding,
  EvaluationReport,
  MetricCounts,
  MetricValues,
  StageDiagnostics,
} from "./types.js";
import {
  computeEdgeWeight,
  checkAntiFindingCompatibility,
  solveMaxWeightLexicographic,
  maxCardinalityMatching,
  solveHopcroftKarpPairs,
} from "./matcher.js";

function assertUniqueIds<T extends { id: string }>(items: T[], label: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) {
      throw new Error(`Duplicate ${label} ID found: ${item.id}`);
    }
    seen.add(item.id);
  }
}

export function evaluateCase(
  deliveredCandidates: CandidateFinding[],
  rejectedCandidates: CandidateFinding[],
  expectedFindings: ExpectedFinding[],
  antiFindings: AntiFinding[],
  caseId: string = "case.default"
): EvaluationReport {
  // Validate duplicate IDs across all 4 input arrays
  assertUniqueIds(deliveredCandidates, "candidate");
  assertUniqueIds(rejectedCandidates, "rejected candidate");
  assertUniqueIds(expectedFindings, "expected finding");
  assertUniqueIds(antiFindings, "anti-finding");

  // Step 1: Dual-Match Quarantine Partitioning (Q vs D_clean)
  const Q: CandidateFinding[] = [];
  const cleanCandidates: CandidateFinding[] = [];
  const maxQuarantineWeight = new Map<string, number>();

  for (const c of deliveredCandidates) {
    const compE: Array<{ expected: ExpectedFinding; weight: number }> = [];
    for (const e of expectedFindings) {
      const res = computeEdgeWeight(c, e);
      if (res.feasible) {
        compE.push({ expected: e, weight: res.weight });
      }
    }
    const compA = antiFindings.filter((a) => checkAntiFindingCompatibility(c, a));

    if (compE.length > 0 && compA.length > 0) {
      Q.push(c);
      for (const { expected: e, weight } of compE) {
        const prev = maxQuarantineWeight.get(e.id) ?? -Infinity;
        if (weight > prev) {
          maxQuarantineWeight.set(e.id, weight);
        }
      }
    } else {
      cleanCandidates.push(c);
    }
  }

  // Step 2: Global Clean Bipartite Matching under strict '>' quarantine rule:
  // A clean candidate can claim an expected finding e with Q(e) != empty ONLY if W(c, e) > W_Q*(e).
  const matchResult = solveMaxWeightLexicographic(
    cleanCandidates,
    expectedFindings,
    (_c, e, weight) => {
      const wQ = maxQuarantineWeight.get(e.id);
      return wQ === undefined || weight > wQ;
    }
  );

  const matchedExpectedIds = new Set(matchResult.matches.map((m) => m.expectedId));

  // Step 3: Contested expected findings C are those compatible with Q that were NOT rescued by a strictly higher-weight clean match
  const contestedExpectedIds = new Set<string>();
  for (const eId of maxQuarantineWeight.keys()) {
    if (!matchedExpectedIds.has(eId)) {
      contestedExpectedIds.add(eId);
    }
  }

  const unmatchedCleanExpected = expectedFindings.filter(
    (e) => !matchedExpectedIds.has(e.id) && !contestedExpectedIds.has(e.id)
  );
  const contestedExpected = expectedFindings.filter((e) =>
    contestedExpectedIds.has(e.id)
  );

  const tp = matchResult.matches.length;
  const fnClean = unmatchedCleanExpected.length;
  const fn = fnClean + contestedExpectedIds.size;

  let fpTrap = 0;
  let fpSpurious = 0;

  for (const cId of matchResult.unmatchedCandidates) {
    const c = cleanCandidates.find((item) => item.id === cId)!;
    const matchesAnti = antiFindings.some((a) =>
      checkAntiFindingCompatibility(c, a)
    );
    if (matchesAnti) {
      fpTrap++;
    } else {
      fpSpurious++;
    }
  }

  const fp = fpTrap + fpSpurious;
  const q = Q.length;

  // Step 4: Compute UQ via Hopcroft-Karp maximum-cardinality matching between Q and C
  const qAdj = new Map<string, string[]>();
  for (const qCand of Q) {
    const validE = contestedExpected
      .filter((e) => computeEdgeWeight(qCand, e).feasible)
      .map((e) => e.id);
    qAdj.set(qCand.id, validE);
  }

  const uq = maxCardinalityMatching(
    Q.map((item) => item.id),
    contestedExpected.map((item) => item.id),
    qAdj
  );

  // Step 5: AFTR calculation on confirmed clean candidates
  let aftr: number | "N/A" = "N/A";
  if (antiFindings.length > 0) {
    const triggeredAntiIds = new Set<string>();
    for (const c of cleanCandidates) {
      for (const a of antiFindings) {
        if (checkAntiFindingCompatibility(c, a)) {
          triggeredAntiIds.add(a.id);
        }
      }
    }
    aftr = triggeredAntiIds.size / antiFindings.length;
  }

  // Step 6: Precision, Recall, F1, Bounds, FDPC, UAR
  const totalDelivered = deliveredCandidates.length;
  const totalExpected = expectedFindings.length;

  // 1. Confirmed Precision: TP / (TP + FP)
  let confirmedPrecision = 0.0;
  if (tp + fp === 0) {
    confirmedPrecision = totalExpected === 0 ? 1.0 : 0.0;
  } else {
    confirmedPrecision = tp / (tp + fp);
  }

  // 2. Conservative Delivered Precision: TP / |D|
  let conservativePrecision = 0.0;
  if (totalDelivered === 0) {
    conservativePrecision = totalExpected === 0 ? 1.0 : 0.0;
  } else {
    conservativePrecision = tp / totalDelivered;
  }

  // 3. Conservative Recall: TP / |E|
  let conservativeRecall: number | "N/A" = "N/A";
  if (totalExpected === 0) {
    conservativeRecall = "N/A";
  } else {
    conservativeRecall = tp / totalExpected;
  }

  // 4. Conservative F1
  let conservativeF1: number | "N/A" = "N/A";
  if (conservativeRecall === "N/A") {
    conservativeF1 = "N/A";
  } else if (conservativePrecision + conservativeRecall === 0) {
    conservativeF1 = 0.0;
  } else {
    conservativeF1 =
      (2 * conservativePrecision * conservativeRecall) /
      (conservativePrecision + conservativeRecall);
  }

  // 5. Optimistic Bounds: (TP + UQ)
  const optimisticPrecision =
    totalDelivered === 0
      ? totalExpected === 0
        ? 1.0
        : 0.0
      : (tp + uq) / totalDelivered;

  let optimisticRecall: number | "N/A" = "N/A";
  if (totalExpected === 0) {
    optimisticRecall = "N/A";
  } else {
    optimisticRecall = (tp + uq) / totalExpected;
  }

  let optimisticF1: number | "N/A" = "N/A";
  if (optimisticRecall === "N/A") {
    optimisticF1 = "N/A";
  } else if (optimisticPrecision + optimisticRecall === 0) {
    optimisticF1 = 0.0;
  } else {
    optimisticF1 =
      (2 * optimisticPrecision * optimisticRecall) /
      (optimisticPrecision + optimisticRecall);
  }

  // 6. Pessimistic Bounds
  const pessimisticPrecision = conservativePrecision;
  const pessimisticRecall = conservativeRecall;
  const pessimisticF1 = conservativeF1;

  // 7. FDPC & UAR
  const fdpc = fp + q;
  const uar = totalDelivered === 0 ? 0.0 : (fp + q) / totalDelivered;

  // Step 7: 1-to-1 Judge False Rejection diagnostics via Hopcroft-Karp matching
  const rejCleanAdj = new Map<string, string[]>();
  for (const r of rejectedCandidates) {
    const validCleanE = unmatchedCleanExpected
      .filter((e) => computeEdgeWeight(r, e).feasible)
      .map((e) => e.id);
    rejCleanAdj.set(r.id, validCleanE);
  }
  const cleanRejectedMatches = solveHopcroftKarpPairs(
    rejectedCandidates.map((r) => r.id),
    unmatchedCleanExpected.map((e) => e.id),
    rejCleanAdj
  );
  const judgeFalseRejectionsClean = cleanRejectedMatches.size;

  const remainingRejected = rejectedCandidates.filter(
    (r) => !cleanRejectedMatches.has(r.id)
  );
  const rejContestedAdj = new Map<string, string[]>();
  for (const r of remainingRejected) {
    const validContestedE = contestedExpected
      .filter((e) => computeEdgeWeight(r, e).feasible)
      .map((e) => e.id);
    rejContestedAdj.set(r.id, validContestedE);
  }
  const judgeFalseRejectionsContested = maxCardinalityMatching(
    remainingRejected.map((r) => r.id),
    contestedExpected.map((e) => e.id),
    rejContestedAdj
  );

  const filteredRecallLoss: number | "N/A" =
    totalExpected === 0 ? "N/A" : judgeFalseRejectionsClean / totalExpected;

  const diagnostics: StageDiagnostics = {
    specialistRecall: "N/A",
    criticFilterRate: "N/A",
    judgeFalseRejectionsClean,
    judgeFalseRejectionsContested,
    judgeFalseRejectionsTotal:
      judgeFalseRejectionsClean + judgeFalseRejectionsContested,
    judgeTotalRejections: rejectedCandidates.length,
  };

  const counts: MetricCounts = {
    tp,
    fp,
    fpTrap,
    fpSpurious,
    fn,
    q,
    uq,
    totalDelivered,
    totalExpected,
    totalAntiFindings: antiFindings.length,
  };

  const metrics: MetricValues = {
    confirmedPrecision,
    conservativePrecision,
    conservativeRecall,
    conservativeF1,
    optimisticPrecision,
    optimisticRecall,
    optimisticF1,
    pessimisticPrecision,
    pessimisticRecall,
    pessimisticF1,
    optimisticBounds: {
      precision: optimisticPrecision,
      recall: optimisticRecall,
      f1: optimisticF1,
    },
    pessimisticBounds: {
      precision: pessimisticPrecision,
      recall: pessimisticRecall,
      f1: pessimisticF1,
    },
    aftr,
    fdpc,
    uar,
    filteredRecallLoss,
  };

  const status = q > 0 ? "PENDING_HUMAN_ADJUDICATION" : "COMPLETE";

  return {
    caseId,
    status,
    counts,
    metrics,
    diagnostics,
  };
}
