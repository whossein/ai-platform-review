import { describe, it, expect } from "vitest";
import {
  normalizeRepoPath,
  computeLineProximity,
  checkCategoryCompatibility,
  computeKeywordScore,
  computeEdgeWeight,
  checkAntiFindingCompatibility,
  buildAugmentedCostMatrix,
  solveHungarianMinCost,
  solveAugmentedHungarianWeight,
  solveMaxWeightLexicographic,
  solveMaxWeightLexicographicFallback,
  sortCandidatesCanonical,
  sortExpectedCanonical,
} from "./matcher.js";
import type { CandidateFinding, ExpectedFinding, AntiFinding } from "./types.js";

describe("Matcher Unit Tests", () => {
  describe("Path Normalization Security & Casing", () => {
    it("preserves case by default", () => {
      expect(normalizeRepoPath("src/App.tsx", false)).toBe("src/App.tsx");
      expect(normalizeRepoPath("src/app.tsx", false)).toBe("src/app.tsx");
      expect(
        normalizeRepoPath("src/App.tsx", false) ===
          normalizeRepoPath("src/app.tsx", false)
      ).toBe(false);
    });

    it("lowercases when caseInsensitiveFs is true", () => {
      expect(normalizeRepoPath("src/App.tsx", false, true)).toBe("src/app.tsx");
      expect(normalizeRepoPath("a/SRC/App.tsx", true, true)).toBe("src/app.tsx");
    });

    it("strips diff headers only when isDiffPath is true", () => {
      expect(normalizeRepoPath("a/src/App.tsx", true)).toBe("src/App.tsx");
      expect(normalizeRepoPath("b/src/App.tsx", true)).toBe("src/App.tsx");
      expect(normalizeRepoPath("a/src/App.tsx", false)).toBe("a/src/App.tsx");
    });

    it("prevents directory traversal above root", () => {
      expect(() => normalizeRepoPath("../../etc/passwd", false)).toThrow(
        "Directory traversal attempt"
      );
    });
  });

  describe("Category Compatibility", () => {
    it("accepts exact matches", () => {
      expect(checkCategoryCompatibility("code", "code")).toEqual({
        compatible: true,
        weight: 150_000,
      });
      expect(checkCategoryCompatibility("security", "security")).toEqual({
        compatible: true,
        weight: 150_000,
      });
    });

    it("accepts directional cross matches", () => {
      expect(checkCategoryCompatibility("code", "architecture")).toEqual({
        compatible: true,
        weight: 75_000,
      });
      expect(checkCategoryCompatibility("security", "correctness")).toEqual({
        compatible: true,
        weight: 75_000,
      });
    });

    it("rejects incompatible pairs", () => {
      expect(checkCategoryCompatibility("testing", "performance")).toEqual({
        compatible: false,
        weight: 0,
      });
      expect(checkCategoryCompatibility("testing", "security")).toEqual({
        compatible: false,
        weight: 0,
      });
    });
  });

  describe("Line Proximity Scoring", () => {
    const baseC: CandidateFinding = {
      id: "c1",
      title: "t",
      description: "d",
      reason: "r",
      location: { file: "test.ts", line: 10, endLine: 10 },
      category: "code",
      severity: "medium",
    };
    const baseE: ExpectedFinding = {
      id: "e1",
      file: "test.ts",
      lineRange: [10, 10],
      category: "code",
      severity: "medium",
      requiredKeywords: [],
      description: "desc",
    };

    it("exact match gives 200,000", () => {
      expect(computeLineProximity(baseC, baseE)).toEqual({
        feasible: true,
        weight: 200_000,
      });
    });

    it("overlap with shift <= 2 gives 150,000", () => {
      const c = { ...baseC, location: { file: "test.ts", line: 8, endLine: 10 } };
      expect(computeLineProximity(c, baseE)).toEqual({
        feasible: true,
        weight: 150_000,
      });
    });

    it("overlap with shift > 2 gives 100,000", () => {
      const c = { ...baseC, location: { file: "test.ts", line: 5, endLine: 10 } };
      expect(computeLineProximity(c, baseE)).toEqual({
        feasible: true,
        weight: 100_000,
      });
    });

    it("non-overlapping within slack gives 100,000", () => {
      const c = { ...baseC, location: { file: "test.ts", line: 12, endLine: 12 } };
      expect(computeLineProximity(c, baseE)).toEqual({
        feasible: true,
        weight: 100_000,
      });
    });

    it("non-overlapping outside slack is infeasible", () => {
      const c = { ...baseC, location: { file: "test.ts", line: 14, endLine: 14 } };
      expect(computeLineProximity(c, baseE)).toEqual({
        feasible: false,
        weight: 0,
      });
    });

    it("rejects non-integer, Infinity, NaN, and non-positive line numbers", () => {
      expect(
        computeLineProximity(
          { ...baseC, location: { file: "test.ts", line: Infinity, endLine: Infinity } },
          baseE
        ).feasible
      ).toBe(false);
      expect(
        computeLineProximity(
          { ...baseC, location: { file: "test.ts", line: 10.5, endLine: 10 } },
          baseE
        ).feasible
      ).toBe(false);
      expect(
        computeLineProximity(
          { ...baseC, location: { file: "test.ts", line: -1, endLine: 10 } },
          baseE
        ).feasible
      ).toBe(false);
    });
  });

  describe("Edge Weight Computation & Keyword Matching", () => {
    it("computes exact maximum weight of 1,000,000 for perfect match", () => {
      const c: CandidateFinding = {
        id: "c-max",
        title: "Exact Title match",
        description: "Exact Description match",
        reason: "Exact reason",
        location: { file: "src/perfect.ts", line: 10, endLine: 10 },
        category: "code",
        severity: "critical",
      };
      const e: ExpectedFinding = {
        id: "e-max",
        file: "src/perfect.ts",
        lineRange: [10, 10],
        category: "code",
        severity: "critical",
        requiredKeywords: ["exact", "match"],
        description: "Exact Description",
      };
      const res = computeEdgeWeight(c, e);
      expect(res.feasible).toBe(true);
      expect(res.weight).toBe(1_000_000);
    });

    it("normalizes multi-symbol keywords and uses Math.round with word boundaries", () => {
      const c: CandidateFinding = {
        id: "c-kw",
        title: "Use in-memory cache for valid provider",
        description: "",
        reason: "",
        location: { file: "src/a.ts", line: 10 },
        category: "performance",
        severity: "high",
      };
      const e: ExpectedFinding = {
        id: "e-kw",
        file: "src/a.ts",
        lineRange: [10, 10],
        category: "performance",
        severity: "high",
        requiredKeywords: ["in--memory", "cache", "id"], // "id" must NOT match "valid" or "provider"
        description: "",
      };
      const kwRes = computeKeywordScore(c, e);
      expect(kwRes.feasible).toBe(true);
      // 2 out of 3 matched -> Math.round((2/3) * 50_000) = 33_333
      expect(kwRes.weight).toBe(33_333);
    });

    it("enforces AntiFinding.category when specified", () => {
      const c: CandidateFinding = {
        id: "c-anti",
        title: "cache in-memory",
        description: "",
        reason: "",
        location: { file: "src/api.ts", line: 50, endLine: 55 },
        category: "testing",
        severity: "low",
      };
      const aWithIncompatibleCat: AntiFinding = {
        id: "a-cat",
        file: "src/api.ts",
        lineRange: [50, 55],
        category: "security",
        triggerKeywords: ["cache"],
        explanation: "Security trap only",
      };
      expect(checkAntiFindingCompatibility(c, aWithIncompatibleCat)).toBe(false);
    });
  });

  describe("Augmented Cost Matrix & Quadrant III Zero Cost", () => {
    it("assigns cost m * MAX_EDGE_WEIGHT (1,000,000) to all-unmatched 1x1 forbidden graph", () => {
      const c0: CandidateFinding = {
        id: "c0",
        title: "x",
        description: "",
        reason: "",
        location: { file: "src/a.ts", line: 10 },
        category: "testing",
        severity: "low",
      };
      const e0: ExpectedFinding = {
        id: "e0",
        file: "src/b.ts",
        lineRange: [90, 95],
        category: "security",
        severity: "critical",
        requiredKeywords: ["sanitize"],
        description: "",
      };
      const { matrix, K } = buildAugmentedCostMatrix([c0], [e0]);
      const assign = solveHungarianMinCost(matrix, K);
      const totalCost = assign.reduce((sum, col, row) => sum + matrix[row]![col]!, 0);
      expect(totalCost).toBe(1_000_000);
      expect(solveAugmentedHungarianWeight([c0], [e0], new Map([[0, 0]]))).toBe(-1);
    });
  });

  describe("Two-Stage Lexicographic Tie-Breaking & Exhaustive Brute-Force Oracle", () => {
    it("breaks tie deterministically by canonical candidate index", () => {
      const cA: CandidateFinding = {
        id: "ca",
        title: "Same",
        description: "",
        reason: "",
        location: { file: "test.ts", line: 10 },
        category: "code",
        severity: "medium",
      };
      const cB: CandidateFinding = {
        id: "cb",
        title: "Same",
        description: "",
        reason: "",
        location: { file: "test.ts", line: 10 },
        category: "code",
        severity: "medium",
      };
      const e1: ExpectedFinding = {
        id: "e1",
        file: "test.ts",
        lineRange: [10, 10],
        category: "code",
        severity: "medium",
        requiredKeywords: [],
        description: "",
      };

      const res1 = solveMaxWeightLexicographic([cA, cB], [e1]);
      expect(res1.matches).toEqual([
        { candidateId: "ca", expectedId: "e1", weight: 1_000_000 },
      ]);

      // Permutation invariance
      const res2 = solveMaxWeightLexicographic([cB, cA], [e1]);
      expect(res2.matches).toEqual([
        { candidateId: "ca", expectedId: "e1", weight: 1_000_000 },
      ]);
    });

    it("resolves symmetric 2x2 equal-weight tie to [(c1, e1), (c2, e2)]", () => {
      const c1: CandidateFinding = {
        id: "c1",
        title: "issue",
        description: "",
        reason: "",
        location: { file: "test.ts", line: 10 },
        category: "code",
        severity: "high",
      };
      const c2: CandidateFinding = {
        id: "c2",
        title: "issue",
        description: "",
        reason: "",
        location: { file: "test.ts", line: 10 },
        category: "code",
        severity: "high",
      };
      const e1: ExpectedFinding = {
        id: "e1",
        file: "test.ts",
        lineRange: [10, 10],
        category: "code",
        severity: "high",
        requiredKeywords: ["issue"],
        description: "",
      };
      const e2: ExpectedFinding = {
        id: "e2",
        file: "test.ts",
        lineRange: [10, 10],
        category: "code",
        severity: "high",
        requiredKeywords: ["issue"],
        description: "",
      };

      const res = solveMaxWeightLexicographic([c2, c1], [e2, e1]);
      expect(res.matches).toEqual([
        { candidateId: "c1", expectedId: "e1", weight: 1_000_000 },
        { candidateId: "c2", expectedId: "e2", weight: 1_000_000 },
      ]);
    });

    it("matches independent exhaustive brute-force oracle across 520 small graphs (m, n <= 6)", () => {
      function bruteForceOracle(U: CandidateFinding[], V: ExpectedFinding[]) {
        const m = U.length;
        const n = V.length;
        let bestWeight = -1;
        let bestVec: number[] = [];

        function isLexSmaller(a: number[], b: number[]): boolean {
          for (let i = 0; i < a.length; i++) {
            const va = a[i]! === -1 ? Infinity : a[i]!;
            const vb = b[i]! === -1 ? Infinity : b[i]!;
            if (va !== vb) return va < vb;
          }
          return false;
        }

        const weights: number[][] = Array.from({ length: m }, () =>
          new Array<number>(n).fill(0)
        );
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

        const used = new Array<boolean>(n).fill(false);
        const current = new Array<number>(m).fill(-1);

        function backtrack(i: number, wSum: number) {
          if (i === m) {
            if (
              wSum > bestWeight ||
              (wSum === bestWeight && isLexSmaller(current, bestVec))
            ) {
              bestWeight = wSum;
              bestVec = [...current];
            }
            return;
          }
          for (let j = 0; j < n; j++) {
            if (!used[j] && feasible[i]![j]) {
              used[j] = true;
              current[i] = j;
              backtrack(i + 1, wSum + weights[i]![j]!);
              used[j] = false;
            }
          }
          current[i] = -1;
          backtrack(i + 1, wSum);
        }

        backtrack(0, 0);
        return { bestWeight, bestVec, weights, feasible };
      }

      // Deterministic PRNG (Mulberry32)
      let seed = 0x1337beef;
      function randInt(mod: number): number {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) % mod;
      }

      const sevs = ["critical", "high", "medium", "low"] as const;
      const cats = ["security", "code", "performance"] as const;
      const kwPool = ["sanitize", "token", "cache", "leak"];

      for (let caseIdx = 0; caseIdx < 520; caseIdx++) {
        const m = 1 + (caseIdx % 6);
        const n = 1 + ((caseIdx * 5 + 2) % 6);
        const rawU: CandidateFinding[] = [];
        const rawV: ExpectedFinding[] = [];

        for (let i = 0; i < m; i++) {
          const line = 10 + randInt(5);
          const kw1 = kwPool[randInt(kwPool.length)]!;
          const kw2 = kwPool[randInt(kwPool.length)]!;
          rawU.push({
            id: `c-${i}`,
            title: `${kw1} ${kw2}`,
            description: "",
            reason: "",
            location: { file: randInt(4) === 0 ? "src/other.ts" : "src/main.ts", line, endLine: line },
            category: cats[randInt(cats.length)]!,
            severity: sevs[randInt(sevs.length)]!,
          });
        }

        for (let j = 0; j < n; j++) {
          const line = 10 + randInt(5);
          const req = [kwPool[randInt(kwPool.length)]!];
          if (randInt(2) === 1) req.push(kwPool[randInt(kwPool.length)]!);
          rawV.push({
            id: `e-${j}`,
            file: randInt(4) === 0 ? "src/other.ts" : "src/main.ts",
            lineRange: [line, line],
            category: cats[randInt(cats.length)]!,
            severity: sevs[randInt(sevs.length)]!,
            requiredKeywords: req,
            description: "",
          });
        }

        const U = sortCandidatesCanonical(rawU);
        const V = sortExpectedCanonical(rawV);
        const oracle = bruteForceOracle(U, V);
        const fastRes = solveMaxWeightLexicographic(rawU, rawV);
        const fallbackRes = solveMaxWeightLexicographicFallback(
          U,
          V,
          oracle.weights,
          oracle.feasible
        );

        const fastVec = U.map((u) => {
          const mPair = fastRes.matches.find((item) => item.candidateId === u.id);
          return mPair ? V.findIndex((v) => v.id === mPair.expectedId) : -1;
        });

        expect(fastRes.totalWeight).toBe(oracle.bestWeight);
        expect(fastVec).toEqual(oracle.bestVec);
        expect(fastRes).toEqual(fallbackRes);
      }
    });
  });
});
