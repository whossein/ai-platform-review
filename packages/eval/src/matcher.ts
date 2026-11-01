import type {
  CandidateFinding,
  ExpectedFinding,
  AntiFinding,
  MatchingResult,
  MatchedPair,
} from "./types.js";

export const MAX_EDGE_WEIGHT = 1_000_000;
export const BASE_FEASIBILITY_SCORE = 500_000;
export const LINE_SLACK_MAX = 2;
export const INPUT_SIZE_LIMIT = 1_000;

export function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Hardened repository path normalizer preserving case by default (or lowercasing
 * when caseInsensitiveFs is true), handling diff headers safely, and preventing traversal attacks.
 */
export function normalizeRepoPath(
  filePath: string,
  isDiffPath: boolean = false,
  caseInsensitiveFs: boolean = false
): string {
  if (!filePath) return "";
  let p = filePath.replace(/\\/g, "/");

  if (isDiffPath) {
    p = p.replace(/^(a|b)\//, "");
  }

  p = p.replace(/^\.\//, "").replace(/^\/+/, "").replace(/\/+$/, "");

  const parts = p.split("/").filter(Boolean);
  const stack: string[] = [];
  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") {
      if (stack.length === 0) {
        throw new Error("Directory traversal attempt");
      }
      stack.pop();
    } else {
      stack.push(part);
    }
  }

  const normalized = stack.join("/");
  return caseInsensitiveFs ? normalized.toLowerCase() : normalized;
}

const CATEGORY_EXACT = new Set([
  "code",
  "security",
  "performance",
  "architecture",
  "accessibility",
  "testing",
  "dependency",
  "documentation",
  "maintainability",
  "correctness",
]);

const CATEGORY_CROSS: Record<string, Set<string>> = {
  code: new Set(["architecture", "maintainability"]),
  architecture: new Set(["code", "performance"]),
  security: new Set(["correctness", "code"]),
  performance: new Set(["code", "architecture"]),
};

export function checkCategoryCompatibility(
  cCat: string,
  eCat: string
): { compatible: boolean; weight: number } {
  if (cCat === eCat && CATEGORY_EXACT.has(cCat)) {
    return { compatible: true, weight: 150_000 };
  }
  if (CATEGORY_CROSS[cCat]?.has(eCat)) {
    return { compatible: true, weight: 75_000 };
  }
  return { compatible: false, weight: 0 };
}

export function parseCandidateLine(c: CandidateFinding): {
  valid: boolean;
  start: number;
  end: number;
} {
  const line = c.location?.line;
  if (line === undefined || line === null || !Number.isSafeInteger(line) || line <= 0) {
    return { valid: false, start: 0, end: 0 };
  }
  const rawEnd = c.location?.endLine;
  if (rawEnd !== undefined && rawEnd !== null) {
    if (!Number.isSafeInteger(rawEnd) || rawEnd <= 0) {
      return { valid: false, start: 0, end: 0 };
    }
  }
  const endLine = rawEnd !== undefined && rawEnd !== null ? rawEnd : line;

  const start = Math.min(line, endLine);
  const end = Math.max(line, endLine);
  return { valid: true, start, end };
}

export function parseLineRangeTuple(range?: [number, number]): {
  valid: boolean;
  start: number;
  end: number;
} {
  const s = range?.[0];
  const end = range?.[1];
  if (
    s === undefined ||
    end === undefined ||
    !Number.isSafeInteger(s) ||
    !Number.isSafeInteger(end) ||
    s <= 0 ||
    end <= 0
  ) {
    return { valid: false, start: 0, end: 0 };
  }
  return { valid: true, start: Math.min(s, end), end: Math.max(s, end) };
}

export function parseExpectedLine(e: ExpectedFinding): {
  valid: boolean;
  start: number;
  end: number;
} {
  return parseLineRangeTuple(e.lineRange);
}

export function computeLineProximity(
  c: CandidateFinding,
  e: ExpectedFinding
): { feasible: boolean; weight: number } {
  const cLine = parseCandidateLine(c);
  const eLine = parseExpectedLine(e);
  if (!cLine.valid || !eLine.valid) {
    return { feasible: false, weight: 0 };
  }

  const overlap = Math.max(cLine.start, eLine.start) <= Math.min(cLine.end, eLine.end);
  let distLine = 0;
  if (!overlap) {
    distLine = Math.max(cLine.start, eLine.start) - Math.min(cLine.end, eLine.end);
  }

  if (distLine > LINE_SLACK_MAX) {
    return { feasible: false, weight: 0 };
  }

  if (distLine === 0) {
    const shiftBoundary =
      Math.abs(cLine.start - eLine.start) + Math.abs(cLine.end - eLine.end);
    if (shiftBoundary === 0) {
      return { feasible: true, weight: 200_000 };
    }
    if (shiftBoundary <= 2) {
      return { feasible: true, weight: 150_000 };
    }
    return { feasible: true, weight: 100_000 };
  }

  // 1 <= distLine <= 2
  return { feasible: true, weight: 100_000 };
}

const SEVERITY_TIERS: Record<string, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

export function computeSeverityScore(cSev: string, eSev: string): number {
  const cT = SEVERITY_TIERS[cSev] ?? 3;
  const eT = SEVERITY_TIERS[eSev] ?? 3;
  const diff = Math.abs(cT - eT);
  if (diff === 0) return 100_000;
  if (diff === 1) return 50_000;
  return 0;
}

export function normalizeTokenText(raw: string): string {
  return raw
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function containsBoundedKeyword(paddedNormText: string, kwNorm: string): boolean {
  if (!kwNorm) return false;
  return paddedNormText.includes(` ${kwNorm} `);
}

export function computeKeywordScore(
  c: CandidateFinding,
  e: ExpectedFinding
): { feasible: boolean; weight: number } {
  const textRaw = `${c.title || ""} ${c.description || ""} ${c.reason || ""} ${c.suggestion || ""}`;
  const paddedText = ` ${normalizeTokenText(textRaw)} `;

  if (e.forbiddenKeywords && e.forbiddenKeywords.length > 0) {
    for (const kw of e.forbiddenKeywords) {
      const kwNorm = normalizeTokenText(kw);
      if (kwNorm && containsBoundedKeyword(paddedText, kwNorm)) {
        return { feasible: false, weight: 0 };
      }
    }
  }

  const req = Array.from(
    new Set((e.requiredKeywords || []).map(normalizeTokenText).filter(Boolean))
  );
  if (req.length === 0) {
    return { feasible: true, weight: 50_000 };
  }

  let matched = 0;
  for (const kwNorm of req) {
    if (containsBoundedKeyword(paddedText, kwNorm)) {
      matched++;
    }
  }

  const score = Math.round((matched / req.length) * 50_000);
  return { feasible: true, weight: score };
}

export function computeEdgeWeight(
  c: CandidateFinding,
  e: ExpectedFinding
): { feasible: boolean; weight: number } {
  if (normalizeRepoPath(c.location.file, false) !== normalizeRepoPath(e.file, false)) {
    return { feasible: false, weight: 0 };
  }

  const line = computeLineProximity(c, e);
  if (!line.feasible) return { feasible: false, weight: 0 };

  const cat = checkCategoryCompatibility(c.category, e.category);
  if (!cat.compatible) return { feasible: false, weight: 0 };

  const kw = computeKeywordScore(c, e);
  if (!kw.feasible) return { feasible: false, weight: 0 };

  const sevScore = computeSeverityScore(c.severity, e.severity);

  const total = BASE_FEASIBILITY_SCORE + line.weight + cat.weight + sevScore + kw.weight;
  return { feasible: true, weight: total };
}

export function checkAntiFindingCompatibility(
  c: CandidateFinding,
  a: AntiFinding
): boolean {
  if (normalizeRepoPath(c.location.file, false) !== normalizeRepoPath(a.file, false)) {
    return false;
  }
  const cLine = parseCandidateLine(c);
  const aLine = parseLineRangeTuple(a.lineRange);
  if (!cLine.valid || !aLine.valid) return false;

  if (a.category !== undefined) {
    if (!checkCategoryCompatibility(c.category, a.category).compatible) {
      return false;
    }
  }

  const overlap = Math.max(cLine.start, aLine.start) <= Math.min(cLine.end, aLine.end);
  let dist = 0;
  if (!overlap) {
    dist = Math.max(cLine.start, aLine.start) - Math.min(cLine.end, aLine.end);
  }
  if (dist > LINE_SLACK_MAX) return false;

  const textRaw = `${c.title || ""} ${c.description || ""} ${c.reason || ""} ${c.suggestion || ""}`;
  const paddedText = ` ${normalizeTokenText(textRaw)} `;

  const validTriggers = (a.triggerKeywords || []).map(normalizeTokenText).filter(Boolean);
  if (validTriggers.length === 0) {
    return true;
  }

  for (const kwNorm of validTriggers) {
    if (containsBoundedKeyword(paddedText, kwNorm)) {
      return true;
    }
  }

  return false;
}

export function sortCandidatesCanonical(list: CandidateFinding[]): CandidateFinding[] {
  return [...list].sort((a, b) => {
    const pathA = normalizeRepoPath(a.location.file, false);
    const pathB = normalizeRepoPath(b.location.file, false);
    if (pathA !== pathB) return compareCodeUnits(pathA, pathB);
    const lineA = a.location.line ?? 0;
    const lineB = b.location.line ?? 0;
    if (lineA !== lineB) return lineA - lineB;
    const endA = a.location.endLine ?? lineA;
    const endB = b.location.endLine ?? lineB;
    if (endA !== endB) return endA - endB;
    return compareCodeUnits(a.id, b.id);
  });
}

export function sortExpectedCanonical(list: ExpectedFinding[]): ExpectedFinding[] {
  return [...list].sort((a, b) => {
    const pathA = normalizeRepoPath(a.file, false);
    const pathB = normalizeRepoPath(b.file, false);
    if (pathA !== pathB) return compareCodeUnits(pathA, pathB);
    const sA = a.lineRange[0];
    const sB = b.lineRange[0];
    if (sA !== sB) return sA - sB;
    const eA = a.lineRange[1];
    const eB = b.lineRange[1];
    if (eA !== eB) return eA - eB;
    return compareCodeUnits(a.id, b.id);
  });
}

export interface HungarianDualResult {
  assignment: number[];
  colToRow: number[];
  u: number[];
  v: number[];
}

/**
 * Kuhn-Munkres (Hungarian) minimum-cost solver on a square N x N matrix returning
 * both primal assignment and optimal 1-indexed dual potentials (u, v).
 */
export function solveHungarianWithDuals(
  costMatrix: number[][],
  N: number
): HungarianDualResult {
  if (N === 0) {
    return { assignment: [], colToRow: [], u: [], v: [] };
  }

  const u = new Array<number>(N + 1).fill(0);
  const v = new Array<number>(N + 1).fill(0);
  const p = new Array<number>(N + 1).fill(0);
  const way = new Array<number>(N + 1).fill(0);

  for (let i = 1; i <= N; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(N + 1).fill(Number.MAX_SAFE_INTEGER);
    const used = new Array<boolean>(N + 1).fill(false);

    do {
      used[j0] = true;
      const i0 = p[j0]!;
      let delta = Number.MAX_SAFE_INTEGER;
      let j1 = 0;
      const row = costMatrix[i0 - 1]!;
      const ui0 = u[i0]!;

      for (let j = 1; j <= N; j++) {
        if (!used[j]) {
          const cur = (row[j - 1] ?? 0) - ui0 - v[j]!;
          if (cur < minv[j]!) {
            minv[j] = cur;
            way[j] = j0;
          }
          if (minv[j]! < delta) {
            delta = minv[j]!;
            j1 = j;
          }
        }
      }

      for (let j = 0; j <= N; j++) {
        if (used[j]) {
          u[p[j]!]! += delta;
          v[j]! -= delta;
        } else {
          minv[j]! -= delta;
        }
      }

      j0 = j1;
    } while (p[j0] !== 0);

    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0 !== 0);
  }

  const assignment = new Array<number>(N).fill(-1);
  const colToRow = new Array<number>(N).fill(-1);
  for (let j = 1; j <= N; j++) {
    if (p[j] !== 0) {
      const r = p[j]! - 1;
      const c = j - 1;
      assignment[r] = c;
      colToRow[c] = r;
    }
  }
  return { assignment, colToRow, u, v };
}

/**
 * Standard Kuhn-Munkres (Hungarian) minimum-weight bipartite matching solver on a square N x N matrix.
 */
export function solveHungarianMinCost(costMatrix: number[][], N: number): number[] {
  return solveHungarianWithDuals(costMatrix, N).assignment;
}

export function buildPrecomputedAugmentedCostMatrix(
  m: number,
  n: number,
  weights: number[][],
  feasible: boolean[][],
  commitments?: Map<number, number>
): { matrix: number[][]; K: number; penalty: number } {
  if (m > INPUT_SIZE_LIMIT || n > INPUT_SIZE_LIMIT) {
    throw new Error(`Input size exceeds maximum limit of ${INPUT_SIZE_LIMIT}`);
  }
  const K = m + n;
  const penalty = (m + n + 1) * MAX_EDGE_WEIGHT + 1;

  const matrix: number[][] = Array.from({ length: K }, () =>
    new Array<number>(K).fill(penalty)
  );

  // Quadrant I: Top-Left (m x n) - real candidate-to-expected matches
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      if (feasible[i]![j]) {
        matrix[i]![j] = MAX_EDGE_WEIGHT - weights[i]![j]!;
      } else {
        matrix[i]![j] = penalty;
      }
    }
  }

  // Quadrant II: Top-Right (m x m) - diagonal: candidate unmatched at cost MAX_EDGE_WEIGHT
  for (let i = 0; i < m; i++) {
    matrix[i]![n + i] = MAX_EDGE_WEIGHT;
  }

  // Quadrant III: Bottom-Left (n x n) - diagonal: expected unmatched at cost 0
  for (let j = 0; j < n; j++) {
    matrix[m + j]![j] = 0;
  }

  // Quadrant IV: Bottom-Right (n x m) - zero-cost slack
  for (let r = 0; r < n; r++) {
    const row = matrix[m + r]!;
    for (let c = 0; c < m; c++) {
      row[n + c] = 0;
    }
  }

  // Apply fixed commitments if provided
  if (commitments) {
    for (const [candIdx, expIdx] of commitments.entries()) {
      if (candIdx < 0 || candIdx >= m || expIdx < -1 || expIdx >= n) {
        for (let col = 0; col < K; col++) {
          if (candIdx >= 0 && candIdx < K) matrix[candIdx]![col] = penalty;
        }
      } else if (expIdx >= 0) {
        for (let col = 0; col < K; col++) {
          if (col !== expIdx) matrix[candIdx]![col] = penalty;
        }
        for (let row = 0; row < K; row++) {
          if (row !== candIdx) matrix[row]![expIdx] = penalty;
        }
      } else if (expIdx === -1) {
        const dummyCol = n + candIdx;
        for (let col = 0; col < K; col++) {
          if (col !== dummyCol) matrix[candIdx]![col] = penalty;
        }
      }
    }
  }

  return { matrix, K, penalty };
}

export function buildAugmentedCostMatrix(
  U: CandidateFinding[],
  V: ExpectedFinding[],
  commitments?: Map<number, number>
): { matrix: number[][]; K: number; penalty: number } {
  const m = U.length;
  const n = V.length;
  if (m > INPUT_SIZE_LIMIT || n > INPUT_SIZE_LIMIT) {
    throw new Error(`Input size exceeds maximum limit of ${INPUT_SIZE_LIMIT}`);
  }

  const weights: number[][] = Array.from({ length: m }, () => new Array<number>(n).fill(0));
  const feasible: boolean[][] = Array.from({ length: m }, () =>
    new Array<boolean>(n).fill(false)
  );

  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      const w = computeEdgeWeight(U[i]!, V[j]!);
      if (w.feasible) {
        feasible[i]![j] = true;
        weights[i]![j] = w.weight;
      }
    }
  }

  return buildPrecomputedAugmentedCostMatrix(m, n, weights, feasible, commitments);
}

export function solveAugmentedHungarianWeight(
  U: CandidateFinding[],
  V: ExpectedFinding[],
  commitments?: Map<number, number>
): number {
  const m = U.length;
  const n = V.length;
  if (m === 0 || n === 0) return 0;

  const { matrix, K, penalty } = buildAugmentedCostMatrix(U, V, commitments);
  const assignment = solveHungarianMinCost(matrix, K);

  for (let r = 0; r < K; r++) {
    const c = assignment[r];
    if (c === undefined || c < 0 || matrix[r]![c]! >= penalty) {
      return -1; // Infeasible under commitments
    }
  }

  let totalWeight = 0;
  for (let i = 0; i < m; i++) {
    const j = assignment[i]!;
    if (j < n) {
      totalWeight += MAX_EDGE_WEIGHT - matrix[i]![j]!;
    }
  }
  return totalWeight;
}

/**
 * Reference two-stage residual-solve implementation using precomputed weights.
 * Used as an automatic safety fallback and for oracle verification.
 */
export function solveMaxWeightLexicographicFallback(
  U: CandidateFinding[],
  V: ExpectedFinding[],
  weights: number[][],
  feasible: boolean[][]
): MatchingResult {
  const m = U.length;
  const n = V.length;

  const solveWeightWithCommitments = (commitments?: Map<number, number>): number => {
    const { matrix, K, penalty } = buildPrecomputedAugmentedCostMatrix(
      m,
      n,
      weights,
      feasible,
      commitments
    );
    const assignment = solveHungarianMinCost(matrix, K);
    for (let r = 0; r < K; r++) {
      const c = assignment[r];
      if (c === undefined || c < 0 || matrix[r]![c]! >= penalty) {
        return -1;
      }
    }
    let total = 0;
    for (let i = 0; i < m; i++) {
      const j = assignment[i]!;
      if (j < n) {
        total += weights[i]![j]!;
      }
    }
    return total;
  };

  const maxWeight = solveWeightWithCommitments();
  const commitments = new Map<number, number>();
  const usedExpected = new Set<number>();

  for (let i = 0; i < m; i++) {
    let committed = false;
    for (let j = 0; j < n; j++) {
      if (!usedExpected.has(j) && feasible[i]![j]) {
        commitments.set(i, j);
        const residual = solveWeightWithCommitments(commitments);
        if (residual === maxWeight) {
          usedExpected.add(j);
          committed = true;
          break;
        }
        commitments.delete(i);
      }
    }
    if (!committed) {
      commitments.set(i, -1);
    }
  }

  const matches: MatchedPair[] = [];
  const unmatchedCandidates: string[] = [];

  for (let i = 0; i < m; i++) {
    const j = commitments.get(i);
    if (j !== undefined && j >= 0) {
      matches.push({
        candidateId: U[i]!.id,
        expectedId: V[j]!.id,
        weight: weights[i]![j]!,
      });
    } else {
      unmatchedCandidates.push(U[i]!.id);
    }
  }

  const matchedExpectedIds = new Set(matches.map((item) => item.expectedId));
  const unmatchedExpected = V.filter((e) => !matchedExpectedIds.has(e.id)).map(
    (e) => e.id
  );

  return {
    matches,
    unmatchedCandidates,
    unmatchedExpected,
    totalWeight: maxWeight,
  };
}

/**
 * O((m+n)^3) deterministic maximum-weight bipartite matching with canonical tie-breaking
 * via Complementary Slackness and single-pass Reverse BFS on the zero-slack equality subgraph,
 * with invariant verification and automatic fallback to solveMaxWeightLexicographicFallback.
 */
export function solveMaxWeightLexicographic(
  candidates: CandidateFinding[],
  expected: ExpectedFinding[],
  edgeFilter?: (c: CandidateFinding, e: ExpectedFinding, weight: number) => boolean
): MatchingResult {
  if (candidates.length > INPUT_SIZE_LIMIT || expected.length > INPUT_SIZE_LIMIT) {
    throw new Error(`Input size exceeds maximum limit of ${INPUT_SIZE_LIMIT}`);
  }

  const U = sortCandidatesCanonical(candidates);
  const V = sortExpectedCanonical(expected);
  const m = U.length;
  const n = V.length;

  if (m === 0 || n === 0) {
    return {
      matches: [],
      unmatchedCandidates: U.map((c) => c.id),
      unmatchedExpected: V.map((e) => e.id),
      totalWeight: 0,
    };
  }

  const weights: number[][] = Array.from({ length: m }, () => new Array<number>(n).fill(0));
  const feasible: boolean[][] = Array.from({ length: m }, () =>
    new Array<boolean>(n).fill(false)
  );

  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      const w = computeEdgeWeight(U[i]!, V[j]!);
      if (w.feasible && (!edgeFilter || edgeFilter(U[i]!, V[j]!, w.weight))) {
        feasible[i]![j] = true;
        weights[i]![j] = w.weight;
      }
    }
  }

  const { matrix, K, penalty } = buildPrecomputedAugmentedCostMatrix(
    m,
    n,
    weights,
    feasible
  );
  const { assignment, colToRow, u, v } = solveHungarianWithDuals(matrix, K);

  let initialMaxWeight = 0;
  for (let i = 0; i < m; i++) {
    const j = assignment[i]!;
    if (j < n) {
      initialMaxWeight += weights[i]![j]!;
    }
  }

  // Stage 2: Equality-subgraph alternating cycle tie-breaking in O(m * (m+n)^2) <= O((m+n)^3)
  for (let i = 0; i < m; i++) {
    const cOld = assignment[i]!;
    const rowI = matrix[i]!;
    const ui = u[i + 1]!;
    const zeroSlackSmaller: number[] = [];
    const limit = cOld < n ? cOld : n;

    for (let j = 0; j < limit; j++) {
      if (
        feasible[i]![j] &&
        colToRow[j]! > i &&
        rowI[j]! - ui - v[j + 1]! === 0
      ) {
        zeroSlackSmaller.push(j);
      }
    }

    if (zeroSlackSmaller.length === 0) {
      // Exact safe skip: no uncommitted zero-slack column < cOld exists
      continue;
    }

    // Single Reverse BFS from column cOld in the zero-slack equality subgraph using only rows > i
    const nextColForRow = new Array<number>(K).fill(-1);
    const visitedRow = new Array<boolean>(K).fill(false);
    const colQueue: number[] = [cOld];
    let head = 0;

    while (head < colQueue.length) {
      const c = colQueue[head++]!;
      const vc = v[c + 1]!;
      for (let r = i + 1; r < K; r++) {
        if (visitedRow[r]) continue;
        if (matrix[r]![c]! < penalty && matrix[r]![c]! - u[r + 1]! - vc === 0) {
          visitedRow[r] = true;
          nextColForRow[r] = c;
          const matchedCol = assignment[r]!;
          colQueue.push(matchedCol);
        }
      }
    }

    for (const j of zeroSlackSmaller) {
      const rOld = colToRow[j]!;
      if (visitedRow[rOld]) {
        let curRow = rOld;
        while (curRow !== -1) {
          const targetCol = nextColForRow[curRow]!;
          const nextRow = targetCol === cOld ? -1 : colToRow[targetCol]!;
          assignment[curRow] = targetCol;
          colToRow[targetCol] = curRow;
          curRow = nextRow;
        }
        assignment[i] = j;
        colToRow[j] = i;
        break;
      }
    }
  }

  // Verify optimality and zero-slack invariants; fallback if any invariant fails
  let finalWeight = 0;
  let valid = true;
  const seenCols = new Set<number>();
  for (let r = 0; r < K; r++) {
    const c = assignment[r];
    if (
      c === undefined ||
      c < 0 ||
      c >= K ||
      seenCols.has(c) ||
      matrix[r]![c]! >= penalty ||
      matrix[r]![c]! - u[r + 1]! - v[c + 1]! !== 0
    ) {
      valid = false;
      break;
    }
    seenCols.add(c);
    if (r < m && c < n) {
      if (!feasible[r]![c]) {
        valid = false;
        break;
      }
      finalWeight += weights[r]![c]!;
    }
  }

  if (!valid || finalWeight !== initialMaxWeight) {
    return solveMaxWeightLexicographicFallback(U, V, weights, feasible);
  }

  const matches: MatchedPair[] = [];
  const unmatchedCandidates: string[] = [];

  for (let i = 0; i < m; i++) {
    const j = assignment[i]!;
    if (j < n) {
      matches.push({
        candidateId: U[i]!.id,
        expectedId: V[j]!.id,
        weight: weights[i]![j]!,
      });
    } else {
      unmatchedCandidates.push(U[i]!.id);
    }
  }

  const matchedExpectedIds = new Set(matches.map((item) => item.expectedId));
  const unmatchedExpected = V.filter((e) => !matchedExpectedIds.has(e.id)).map(
    (e) => e.id
  );

  return {
    matches,
    unmatchedCandidates,
    unmatchedExpected,
    totalWeight: finalWeight,
  };
}

/**
 * Hopcroft-Karp algorithm for maximum cardinality bipartite matching returning
 * both cardinality and the matched left->right map.
 */
export function solveHopcroftKarpPairs(
  leftIds: string[],
  rightIds: string[],
  adj: Map<string, string[]>
): Map<string, string> {
  const matchedPairs = new Map<string, string>();
  if (leftIds.length === 0 || rightIds.length === 0) return matchedPairs;

  const pairU = new Map<string, string | null>();
  const pairV = new Map<string, string | null>();
  const dist = new Map<string, number>();

  for (const u of leftIds) pairU.set(u, null);
  for (const v of rightIds) pairV.set(v, null);

  const NIL = "__NIL__";

  function bfs(): boolean {
    const queue: string[] = [];
    let head = 0;
    for (const u of leftIds) {
      if (pairU.get(u) === null) {
        dist.set(u, 0);
        queue.push(u);
      } else {
        dist.set(u, Infinity);
      }
    }
    dist.set(NIL, Infinity);

    while (head < queue.length) {
      const u = queue[head++]!;
      if (dist.get(u)! < dist.get(NIL)!) {
        const neighbors = adj.get(u) || [];
        for (const v of neighbors) {
          if (!pairV.has(v)) continue;
          const nextU = pairV.get(v) || NIL;
          if (dist.get(nextU) === Infinity) {
            dist.set(nextU, dist.get(u)! + 1);
            queue.push(nextU);
          }
        }
      }
    }
    return dist.get(NIL) !== Infinity;
  }

  function dfs(u: string): boolean {
    if (u !== NIL) {
      const neighbors = adj.get(u) || [];
      for (const v of neighbors) {
        if (!pairV.has(v)) continue;
        const nextU = pairV.get(v) || NIL;
        if (dist.get(nextU) === dist.get(u)! + 1) {
          if (dfs(nextU)) {
            pairV.set(v, u);
            pairU.set(u, v);
            return true;
          }
        }
      }
      dist.set(u, Infinity);
      return false;
    }
    return true;
  }

  while (bfs()) {
    for (const u of leftIds) {
      if (pairU.get(u) === null) {
        dfs(u);
      }
    }
  }

  for (const [u, v] of pairU.entries()) {
    if (v !== null) {
      matchedPairs.set(u, v);
    }
  }
  return matchedPairs;
}

export function maxCardinalityMatching(
  leftIds: string[],
  rightIds: string[],
  adj: Map<string, string[]>
): number {
  return solveHopcroftKarpPairs(leftIds, rightIds, adj).size;
}
