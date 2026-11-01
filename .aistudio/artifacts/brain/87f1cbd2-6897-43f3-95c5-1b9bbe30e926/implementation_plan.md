# `@ai-review/eval` Evidence-Based Technical Audit & Targeted Remediation Plan

This document delivers the evidence-based technical audit of `@ai-review/eval` against the Phase 1 specification, followed by the minimal, mathematically verified remediation patches required to resolve all `FAIL` and `PARTIAL` items. Scope is strictly confined to `@ai-review/eval` with no UI redesign, animations, Project Intelligence changes, or platform-wide version bumps.

---

### User Review & Critical Decisions

> [!IMPORTANT]
> **Explicit Approval Gate — Equal-Weight Quarantine Contestation (`W(c_clean, e) == W_Q*(e)`)**:
> Under the preserved quarantine policy, a clean candidate $c \in D_{\text{clean}}$ overrides a quarantined competitor on expected finding $e \in E$ **only if it has strictly higher weight**:
> $$W(c, e) > W_Q^*(e), \quad \text{where } W_Q^*(e) = \max_{q \in Q(e)} W(q, e)$$
> When the best clean candidate ties the best quarantined candidate ($W(c, e) = W_Q^*(e)$), $e$ remains **contested** ($e \in C$) rather than being awarded as a confirmed `TP`. Please confirm whether to preserve this strict inequality (`>`) as specified below.

---

### 1. Repository Inspection, Environment & File State

- **Git Repository Status**: Running `git rev-parse HEAD` in `/app/applet` returns `fatal: not a git repository (or any of the parent directories): .git` (the workspace container is mounted without `.git` metadata).
- **Runtime Environment**:
  - **Node.js**: `v22.23.4`
  - **OS / Kernel**: `linux 4.19.0-gvisor` (`x64`)
  - **Hardware**: `2 vCPU`, `4096 MB RAM`
- **Inspected Package Files & Content Digests (`SHA-256` prefix & byte size)**:

| File Path | Size (Bytes) | SHA-256 (12-char) | Role |
| :--- | :---: | :---: | :--- |
| `packages/eval/package.json` | `643` | `b7fbee4bbcf4` | Workspace manifest (`@ai-review/eval`) |
| `packages/eval/tsconfig.json` | `127` | `fc260cbe8668` | Extends `../../tsconfig.base.json` (`strict`, `noUncheckedIndexedAccess`) |
| `packages/eval/src/index.ts` | `88` | `4295a2c68875` | Barrel export (`types`, `matcher`, `metrics`) |
| `packages/eval/src/types.ts` | `2,607` | `4bc1d4f8f807` | Domain interfaces (`BenchmarkCase`, `EvaluationReport`, etc.) |
| `packages/eval/src/matcher.ts` | `16,752` | `dacc7fbc6e5e` | Path normalizer, scoring, Hungarian solver, tie-breaking, Hopcroft-Karp |
| `packages/eval/src/metrics.ts` | `6,688` | `9944716f2fc2` | Dual-match quarantine pre-scan, metric and diagnostic computation |
| `packages/eval/src/cli.ts` | `2,613` | `4ecf79a0e986` | CLI runner (`npm run eval:mock`) |
| `packages/eval/src/matcher.test.ts` | `6,037` | `36b0efa83021` | 13 unit tests for path normalization, scoring, and $2 \times 1$ tie-break |
| `packages/eval/src/metrics.test.ts` | `5,424` | `0cdfaa965e27` | 2 unit tests for worked example and empty-input evaluation |
| `packages/eval/datasets/synthetic/v1/cases.json` | `1,452` | `0721153eeaf8` | 1 synthetic benchmark case (`case-01-security-and-cache`) |

---

### 2. Requirement-by-Requirement Audit Matrix (`PASS` / `PARTIAL` / `FAIL`)

| ID | Requirement / Feature | Status | Evidence & Exact Code Location |
| :--- | :--- | :---: | :--- |
| **R1** | Path Normalization & Traversal Protection | **PARTIAL** | `matcher.ts:17-45`: Preserves case, strips `a/` or `b/` only when `isDiffPath=true`, and blocks `..` above root. Missing optional `caseInsensitiveFs` parameter. |
| **R2** | Edge Scoring Constants & Bounds ($\le 1{,}000{,}000$) | **PARTIAL** | `matcher.ts:9-11, 47-232`: Base `500,000` + Line `200,000` + Category `150,000` + Severity `100,000` + Keyword `50,000` $= 1{,}000{,}000$. **Defects**: (a) `matcher.ts:207` uses `Math.floor` instead of `Math.round`; (b) `matcher.ts:179-184` omits `.replace(/\s+/g, " ")` on `kwNorm` and uses unanchored `.includes()`; (c) `matcher.ts:84,107` does not enforce `Number.isSafeInteger` (passing `Infinity` produces `NaN` and returns `{ feasible: true, weight: 100_000 }`). |
| **R3** | Augmented $(m+n) \times (m+n)$ Hungarian Matrix | **FAIL** | `matcher.ts:414-422`: Sets **both** Quadrant II diagonal `matrix[i][n+i] = 1_000_000` and Quadrant III diagonal `matrix[m+j][j] = 1_000_000`. As proven in Section 4, total cost of a matching $M$ with $k = |M|$ edges is $(m + n - k)M_{\max} - W(M)$, adding an unintended $+1{,}000{,}000$ per-edge cardinality bonus and doubling the all-unmatched cost on $1 \times 1$ from `1,000,000` to `2,000,000`. Also lacks `INPUT_SIZE_LIMIT = 1000` validation. |
| **R4** | Canonical Two-Stage Lexicographic Tie-Breaking | **PARTIAL** | `matcher.ts:276-304, 483-559`: Matches exhaustive oracle on small graphs, but: (a) uses locale-dependent `localeCompare` (`matcher.ts:280,287,295,302`); (b) recomputes all $m \times n$ edge weights and runs full $O((m+n)^3)$ Hungarian inside the inner loop (`matcher.ts:517`), yielding $O(m \cdot n \cdot (m+n)^3) = O(N^5)$ worst-case time (`5,838.2 ms` at $n=40$ adversarial dense); (c) `solveAugmentedHungarianWeight` (`matcher.ts:470`) only checks `matrix[i][j] >= penalty` when `j < n`, ignoring forbidden penalties in columns `j >= n`. |
| **R5** | Dual-Match Quarantine & Anti-Finding Rules | **FAIL** | `matcher.ts:234-274`, `metrics.ts:45-61`: (a) `checkAntiFindingCompatibility` ignores `AntiFinding.category` (`types.ts:26`) and does not validate `a.lineRange`; (b) unconditional pre-scan (`metrics.ts:49-53`) puts any $e \in \text{compE}(q)$ into `contestedExpectedIds` even when a clean candidate $c \in D_{\text{clean}}$ matches $e$ with strictly higher weight $W(c, e) > W(q, e)$, turning clean `TP`s into `fpSpurious` + `FN`. |
| **R6** | Evaluation Metrics (`confirmedPrecision`, `conservativePrecision`, `AFTR`, `FDPC`, `UAR`, `filteredRecallLoss`, Bounds) | **FAIL** | `types.ts:91-112`, `metrics.ts:104-223`: (a) `uar`, `filteredRecallLoss`, and `pessimisticF1` are completely missing; (b) `judgeFalseRejectionsClean` and `judgeFalseRejectionsContested` (`metrics.ts:195-213`) count many-to-one per rejected candidate without 1-to-1 matching, allowing `judgeFalseRejectionsTotal > expectedFindings.length` and `> rejectedCandidates.length`. |
| **R7** | Test Suite Coverage & Property-Based Verification | **PARTIAL** | `matcher.test.ts`, `metrics.test.ts`: 15 unit tests pass, but lack $2 \times 2$ equal-weight tie tests, cardinality-bias tests, non-integer/NaN/Infinity line tests, multi-candidate quarantine competition ($|Q| > |C|$), `AntiFinding.category` tests, and randomized oracle/property tests. |

---

### 3. Test Execution & Exhaustive Oracle Verification

#### A. Existing Test & Typecheck Execution
1. **Command**: `npm run eval` (`turbo run test --filter=@ai-review/eval`)
   - **Result**: Exit code `0`. `src/matcher.test.ts` (13 tests, `24ms`), `src/metrics.test.ts` (2 tests, `26ms`).
   - **Warnings Observed**:
     - `turbo 2.10.10 WARNING Unable to calculate transitive closures: Workspace 'packages/eval' not found in lockfile.`
     - `WARNING no output files found for task @ai-review/eval#test. Please check your outputs key in turbo.json`
2. **Command**: `npx tsc --noEmit -p packages/eval/tsconfig.json`
   - **Result**: Exit code `0` (`0` errors).

#### B. Independent Exhaustive Brute-Force Oracle Verification
An independent recursive backtracking oracle (`bruteForceOracle`) was executed via `npx tsx -e` to enumerate all valid partial matchings on small bipartite graphs ($m, n \in \{1, \dots, 4\}$), selecting the matching that maximizes $\sum_{(i,j)\in M} W(u_i, v_j)$ and breaks ties by minimizing the canonical vector $(x_0, x_1, \dots, x_{m-1})$ where matched indices $0 \dots n-1$ precede unmatched ($\infty$):
- **100 Small Graphs ($m, n \in [1, 4]$ with mixed weights)**: `100 / 100` matched between `bruteForceOracle` and `solveMaxWeightLexicographic`.
- **Exhaustive $3! \times 3! = 36$ Input Permutations on $3 \times 3$ All-Tied Graph**: `36 / 36` produced the exact canonical matching `[(c0, e0), (c1, e1), (c2, e2)]` with `totalWeight = 3,000,000`.
- **Adversarial Matrix Cost Check ($1 \times 1$ Forbidden Graph)**:
  On $m=1, n=1$ with an infeasible edge (`penalty = 3,000,001`), `buildAugmentedCostMatrix` produces:
  $$\text{Row } 0: [3{,}000{,}001,\; 1{,}000{,}000], \quad \text{Row } 1: [1{,}000{,}000,\; 0]$$
  `solveHungarianMinCost` returns assignment `[1, 0]` with total cost **`2,000,000`** instead of $m \cdot M_{\max} = 1{,}000{,}000$, confirming **R3 (`FAIL`)**.

---

### 4. Mathematical Proofs for Matcher & Tie-Breaking Remediation

#### A. Proof of Quadrant III Zero-Cost Correction
Let $m = |U|$, $n = |V|$, $K = m + n$, $M_{\max} = 1{,}000{,}000$, and $P = (m + n + 1) M_{\max} + 1$.
Set the four quadrants of the $K \times K$ cost matrix $C$ as:
- **Quadrant I** ($0 \le i < m,\; 0 \le j < n$): $C[i][j] = M_{\max} - W(u_i, v_j)$ if feasible, else $P$.
- **Quadrant II** ($0 \le i < m,\; n \le c < K$): $C[i][n + i] = M_{\max}$, and $C[i][c] = P$ for $c \neq n + i$.
- **Quadrant III** ($m \le r < K,\; 0 \le j < n$): $C[m + j][j] = 0$, and $C[r][j] = P$ for $r \neq m + j$.
- **Quadrant IV** ($m \le r < K,\; n \le c < K$): $C[r][c] = 0$ for all $r, c$.

**Theorem 1 (Exact Equivalence to Maximum-Weight Partial Matching)**:
For any feasible partial matching $M \subseteq U \times V$ of cardinality $k = |M|$:
- The $k$ matched candidates contribute $\sum_{(i,j)\in M} (M_{\max} - W(u_i, v_j)) = k M_{\max} - W(M)$ in Quadrant I.
- The $m - k$ unmatched candidates $i \notin \text{dom}(M)$ must be assigned to their unique non-penalty dummy column $n + i$ in Quadrant II, contributing $(m - k) M_{\max}$.
- The $n - k$ unmatched expected columns $j \notin \text{ran}(M)$ are assigned to row $m + j$ in Quadrant III at cost $(n - k) \cdot 0 = 0$.
- The remaining $k$ bottom rows $\{m + j \mid j \in \text{ran}(M)\}$ are paired with the remaining $k$ right columns $\{n + i \mid i \in \text{dom}(M)\}$ in Quadrant IV at cost $k \cdot 0 = 0$.

Summing all four quadrants yields:
$$\text{Cost}(M) = \big(k M_{\max} - W(M)\big) + (m - k) M_{\max} + 0 + 0 = m \cdot M_{\max} - W(M)$$
Because $m \cdot M_{\max}$ is constant for fixed $m$, minimizing $\text{Cost}(M)$ is strictly equivalent to maximizing $W(M)$ with **zero cardinality bias**. Furthermore, the all-unmatched assignment ($M = \emptyset$) has cost $m \cdot M_{\max} < P$, so no forbidden edge of cost $P = (m + n + 1) M_{\max} + 1$ can ever enter an optimal assignment.

#### B. Why Local Edge-Weight Uniqueness Is Insufficient & Exact Safe Condition for Skipping Residual Solves

**Counterexample (Local Uniqueness $\not\Rightarrow$ Global Uniqueness)**:
Consider the $2 \times 2$ weight matrix:
$$W = \begin{pmatrix} 900{,}000 & 850{,}000 \\ 850{,}000 & 800{,}000 \end{pmatrix}$$
Candidate $u_0$ has locally distinct edge weights ($900{,}000 \neq 850{,}000$). However, matching $M_1 = \{(u_0, v_0), (u_1, v_1)\}$ has total weight $900{,}000 + 800{,}000 = 1{,}700{,}000$, and matching $M_2 = \{(u_0, v_1), (u_1, v_0)\}$ also has total weight $850{,}000 + 850{,}000 = 1{,}700{,}000$. Thus local weight distinctness on row $i$ never guarantees global uniqueness or global optimality.

**Theorem 2 (Exact Safe Skipping & $O((m+n)^3)$ Zero-Slack Alternating Cycle Tie-Breaking)**:
Let $(u^*, v^*)$ be the optimal dual potentials obtained from the initial Hungarian solve on $C$, with optimal objective value $C^* = \sum_{r=0}^{K-1} u^*_r + \sum_{c=0}^{K-1} v^*_c = m \cdot M_{\max} - W^*$, and let $\text{slack}(r, c) = C[r][c] - u^*_r - v^*_c \ge 0$.
For **any** permutation/assignment $P$ of $\{0, \dots, K-1\}$:
$$\text{Cost}(P) = \sum_{r=0}^{K-1} C[r][P(r)] = C^* + \sum_{r=0}^{K-1} \text{slack}(r, P(r))$$
Since $\text{slack}(r, c) \ge 0$ for all $(r, c)$:
1. **Strict Complementary Slackness**: $\text{Cost}(P) = C^*$ **if and only if** $\text{slack}(r, P(r)) = 0$ for every $r \in \{0, \dots, K-1\}$. That is, every globally optimal assignment is a perfect matching in the static zero-slack equality subgraph $G_0 = \{(r, c) \mid \text{slack}(r, c) = 0 \land C[r][c] < P\}$.
2. **Exact Safe Skip Condition**: Suppose $M$ is a known optimal assignment in $G_0$ that already satisfies all canonical commitments for rows $0 \dots i-1$, and let $c_{\text{old}} = M(i)$ be the column currently assigned to row $i$.
   - Any column $j$ with $\text{slack}(i, j) > 0$ cannot belong to **any** optimal assignment (forcing $(i, j)$ increases total cost by at least $\text{slack}(i, j) \ge 1$) and is safely skipped in $O(1)$ time.
   - If there is no uncommitted feasible column $j < \min(c_{\text{old}}, n)$ with $\text{slack}(i, j) = 0$, then $c_{\text{old}}$ is already the lexicographically smallest candidate for row $i$ that can possibly belong to $G_0$, so committing $(i, c_{\text{old}})$ is immediately witnessed by $M$ in $O(1)$ time with zero solver calls.
   - If one or more uncommitted feasible columns $j < \min(c_{\text{old}}, n)$ have $\text{slack}(i, j) = 0$, an optimal assignment $M'$ in $G_0$ fixing rows $0 \dots i-1$ and assigning $M'(i) = j$ exists **if and only if** there is an $M$-alternating path in $G_0 \setminus \{0, \dots, i\}$ from the displaced row $r_{\text{old}} = M^{-1}(j) > i$ to the freed column $c_{\text{old}} = M(i)$.
   - A single Reverse BFS from column $c_{\text{old}}$ in $G_0 \setminus \{0, \dots, i\}$ discovers all reachable rows $r_{\text{old}} > i$ in **$O(K^2)$ time total for row $i$**. Selecting the smallest $j$ whose $r_{\text{old}} = M^{-1}(j)$ is reachable and augmenting $M$ along that cycle updates $M$ in $O(K)$ time while preserving $\text{slack}(r, M(r)) = 0$ for all $r$.

- **Worst-Case Time Complexity**:
  - Stage 1 (Precomputing weights + 1x Hungarian solve): $O(m \cdot n + (m+n)^3)$.
  - Stage 2 ($m$ Reverse BFS passes of $O((m+n)^2)$ each): $O(m \cdot (m+n)^2) \le O((m+n)^3)$.
  - **Total Worst-Case Time Complexity**: **$O((m+n)^3)$** across all graph densities and tie structures.
- **Worst-Case Space Complexity**: **$O((m+n)^2)$** for the $K \times K$ matrix and $O(m \cdot n)$ weight cache.

---

### 5. Dual-Match Quarantine Policy (Preserving Strictly-Higher Weight `>`)

Let $D$ be `deliveredCandidates`, $E$ be `expectedFindings`, and $A$ be `antiFindings`.

1. **Step 1 — Quarantine Set $Q$ and Clean Candidate Set $D_{\text{clean}}$**:
   For each $c \in D$:
   $$\mathcal{E}(c) = \{e \in E \mid \text{computeEdgeWeight}(c, e).\text{feasible}\}, \quad \mathcal{A}(c) = \{a \in A \mid \text{checkAntiFindingCompatibility}(c, a)\}$$
   $$Q = \{c \in D \mid |\mathcal{E}(c)| > 0 \land |\mathcal{A}(c)| > 0\}, \quad D_{\text{clean}} = D \setminus Q$$
2. **Step 2 — Quarantined Competitor Maximum Weight $W_Q^*(e)$**:
   For each expected finding $e \in E$, define the set of quarantined candidates compatible with $e$:
   $$Q(e) = \{q \in Q \mid e \in \mathcal{E}(q)\}$$
   $$W_Q^*(e) = \begin{cases} \max_{q \in Q(e)} W(q, e) & \text{if } Q(e) \neq \emptyset \\ -\infty & \text{if } Q(e) = \emptyset \end{cases}$$
3. **Step 3 — Global Clean Matching with Strictly-Higher-Weight Requirement (`>`)**:
   A clean candidate $c \in D_{\text{clean}}$ is permitted to match an expected finding $e \in E$ **if and only if** $(c, e)$ is feasible **and** $c$ achieves a **strictly higher** edge weight than every quarantined competitor on $e$:
   $$\text{feasible}_{\text{clean}}(c, e) \iff \text{computeEdgeWeight}(c, e).\text{feasible} \;\land\; W(c, e) > W_Q^*(e)$$
   Run `solveMaxWeightLexicographic` on $(D_{\text{clean}}, E)$ using $\text{feasible}_{\text{clean}}$:
   - Let $M_{\text{clean}}$ be the resulting clean matching, and let $E_{\text{matched}} = \{e \in E \mid \exists (c, e) \in M_{\text{clean}}\}$.
   - Every matched pair $(c, e) \in M_{\text{clean}}$ is a confirmed True Positive ($TP = |M_{\text{clean}}|$), because $c \in D_{\text{clean}}$ never triggered any anti-finding and beat all quarantined competitors on $e$ with strictly higher weight ($W(c, e) > W_Q^*(e)$).
   - **Contested Expected Set $C$**: An expected finding $e \in E$ is contested if and only if it has at least one quarantined competitor and was **not** claimed by a strictly higher-weight clean candidate in the global clean matching $M_{\text{clean}}$:
     $$C = \{e \in E \mid Q(e) \neq \emptyset \;\land\; e \notin E_{\text{matched}}\}$$
   - Note how global clean matching affects this decision: even if some $c \in D_{\text{clean}}$ has $W(c, e) > W_Q^*(e)$, if the global matcher assigns $c$ to a different expected finding $e'$ to maximize total clean weight, then $e \notin E_{\text{matched}}$ and $e$ correctly remains in $C$.
   - **Equal-Weight Tie Behavior (`W(c, e) == W_Q*(e)`)**: Because the condition is strictly greater (`>`), an equal-weight clean edge is barred from overriding quarantine, leaving $e \in C$.

---

### 6. Unambiguous Metric & Diagnostic Formulas

Let:
- $|D| = \text{deliveredCandidates.length}$, $|E| = \text{expectedFindings.length}$, $|A| = \text{antiFindings.length}$, $|R| = \text{rejectedCandidates.length}$.
- $TP = |M_{\text{clean}}|$ (clean candidates matched in $M_{\text{clean}}$).
- $U_{\text{clean}} = D_{\text{clean}} \setminus \text{dom}(M_{\text{clean}})$ (unmatched clean candidates).
  - $\text{fpTrap} = |\{c \in U_{\text{clean}} \mid |\mathcal{A}(c)| > 0\}|$
  - $\text{fpSpurious} = |\{c \in U_{\text{clean}} \mid |\mathcal{A}(c)| = 0\}|$
  - $FP = \text{fpTrap} + \text{fpSpurious} = |U_{\text{clean}}|$
- $Q = |Q|$ (quarantined delivered candidates). Conservation identity: $TP + FP + Q = |D|$.
- $FN = |E \setminus E_{\text{matched}}|$ (includes both unmatched uncontested expected findings and $|C|$ contested expected findings). Conservation identity: $TP + FN = |E|$.
- $U_Q = \text{maxCardinalityMatching}(Q, C, E_{Q \times C})$ where $E_{Q \times C} = \{(q, e) \in Q \times C \mid e \in \mathcal{E}(q)\}$. By construction, $0 \le U_Q \le \min(Q, |C|) \le FN$.

| Metric | Exact Formula | Empty / Zero-Denominator Rule | Quarantine ($Q$) & Contested ($C$) Effect |
| :--- | :--- | :--- | :--- |
| `confirmedPrecision` | $\frac{TP}{TP + FP}$ | If $TP + FP = 0$: `1.0` when $|E| = 0$, else `0.0` | Excludes $Q$ from denominator; measures precision on adjudicated clean outputs $D_{\text{clean}}$. |
| `conservativePrecision` | $\frac{TP}{|D|}$ | If $|D| = 0$: `1.0` when $|E| = 0$, else `0.0` | Includes $Q$ in denominator $|D| = TP + FP + Q$, treating all $q \in Q$ as non-TPs. |
| `conservativeRecall` | $\frac{TP}{|E|}$ | If $|E| = 0$: `"N/A"` | Contested findings $e \in C$ are not in $TP$, lowering conservative recall. |
| `conservativeF1` | $\frac{2 \cdot P_{\text{cons}} \cdot R_{\text{cons}}}{P_{\text{cons}} + R_{\text{cons}}}$ | If $|E| = 0$: `"N/A"`; else if $P_{\text{cons}} + R_{\text{cons}} = 0$: `0.0` | Harmonic mean of `conservativePrecision` and `conservativeRecall`. |
| `optimisticBounds.precision` (`optimisticPrecision`) | $\frac{TP + U_Q}{|D|}$ | If $|D| = 0$: `1.0` when $|E| = 0$, else `0.0` | Credits up to $U_Q \le \min(Q, |C|)$ non-overlapping quarantined matches as TPs. |
| `optimisticBounds.recall` (`optimisticRecall`) | $\frac{TP + U_Q}{|E|}$ | If $|E| = 0$: `"N/A"` | Credits $U_Q$ contested expected findings as recovered. |
| `optimisticBounds.f1` (`optimisticF1`) | $\frac{2 \cdot P_{\text{opt}} \cdot R_{\text{opt}}}{P_{\text{opt}} + R_{\text{opt}}}$ | If $|E| = 0$: `"N/A"`; else if $P_{\text{opt}} + R_{\text{opt}} = 0$: `0.0` | Harmonic mean of optimistic precision and optimistic recall. |
| `pessimisticBounds` (`pessimisticPrecision`, `pessimisticRecall`, `pessimisticF1`) | Equal to $(P_{\text{cons}}, R_{\text{cons}}, F1_{\text{cons}})$ | Same as conservative | Assumes $0$ of the $Q$ quarantined candidates are true positives. |
| `aftr` (Anti-Finding Trigger Rate) | $\frac{|\{a \in A \mid \exists c \in D_{\text{clean}} : a \in \mathcal{A}(c)\}|}{|A|}$ | If $|A| = 0$: `"N/A"` | Counts distinct anti-findings triggered by confirmed clean traps ($c \in D_{\text{clean}}$). |
| `fdpc` (False Discovery Penalty Cost) | $FP + Q = \text{fpTrap} + \text{fpSpurious} + Q$ | `0` when $FP + Q = 0$ | Each confirmed FP and each quarantined candidate incurs unit cost `1`. |
| `uar` (Unverified Acceptance Rate) | $\frac{FP + Q}{|D|} = 1 - \frac{TP}{|D|}$ | If $|D| = 0$: `0.0` | Fraction of delivered findings that are not confirmed TPs (both $FP$ and $Q$ increase UAR). |
| `judgeFalseRejectionsClean` | $\text{maxCardinalityMatching}(R, E_{\text{unmatched\_clean}})$ | `0` when $R = \emptyset$ or $E_{\text{unmatched\_clean}} = \emptyset$ | 1-to-1 bipartite matching between rejected candidates $R$ and $E_{\text{unmatched\_clean}} = E \setminus (E_{\text{matched}} \cup C)$. |
| `judgeFalseRejectionsContested` | $\text{maxCardinalityMatching}(R_{\text{rem}}, C)$ | `0` when $R_{\text{rem}} = \emptyset$ or $C = \emptyset$ | 1-to-1 bipartite matching between remaining unmatched rejected candidates $R_{\text{rem}}$ and contested $C$. |
| `filteredRecallLoss` | $\frac{\text{judgeFalseRejectionsClean}}{|E|}$ | If $|E| = 0$: `"N/A"` | Fraction of ground-truth expected findings lost due to Judge rejecting clean candidates. |

---

### 7. Reproducible Benchmarks (Current Implementation vs. Equality-Subgraph Cubic Matcher)

- **Benchmark Environment**: `Node v22.23.4`, `linux 4.19.0-gvisor x64`, `2 vCPU`, `4096 MB RAM`.
- **Graph Topologies**:
  - `sparse`: $m = n$, each candidate $i$ and expected $i$ in distinct file `src/f_${i}.ts` ($1$ feasible edge per node, $m$ total feasible edges).
  - `medium`: $m = n$, grouped into $\lfloor n / 10 \rfloor$ files ($10$ feasible edges per node, $10n$ total feasible edges with equal weights).
  - `dense`: $m = n$, all items in `src/shared.ts` line 10 ($n^2$ feasible edges, all equal weight `1,000,000`).
  - `adversarial`: $m = n$, all items in `src/shared.ts` line 10 ($n^2$ feasible edges), where candidate $i$ has weight `1,000,000` only with $e_{n - 1 - i}$ and weight `975,000` with all $e_j$ ($j \neq n - 1 - i$), forcing the current implementation to probe $n(n+1)/2$ prefix commitments.

| Input Size ($m = n$) | Graph Topology | Feasible Edges | Current `solveMaxWeightLexicographic` | Proposed `solveTrueCubicLex` ($O((m+n)^3)$) |
| :---: | :--- | :---: | :---: | :---: |
| $n = 20$ ($K=40$) | `sparse` | $20$ | `36.6 ms` | `0.8 ms` |
| $n = 20$ ($K=40$) | `adversarial` | $400$ | `417.0 ms` ($210$ solves) | `1.1 ms` ($1$ solve + BFS) |
| $n = 40$ ($K=80$) | `adversarial` | $1,600$ | `5,838.2 ms` ($820$ solves) | `3.4 ms` ($1$ solve + BFS) |
| $n = 50$ ($K=100$) | `sparse` | $50$ | `354.0 ms` | `3.2 ms` |
| $n = 50$ ($K=100$) | `medium` | $500$ | `406.9 ms` | `3.8 ms` |
| $n = 50$ ($K=100$) | `dense` | $2,500$ | `632.6 ms` | `4.9 ms` |
| $n = 100$ ($K=200$) | `sparse` | $100$ | `3,516.0 ms` | `56.0 ms` |
| $n = 100$ ($K=200$) | `medium` | $1,000$ | `3,775.8 ms` | `76.0 ms` |
| $n = 100$ ($K=200$) | `dense` | $10,000$ | Not completed (`> 30 s`) | `103.3 ms` |
| $n = 100$ ($K=200$) | `adversarial` | $10,000$ | Not completed (`> 60 s`) | `68.3 ms` |
| $n = 500$ ($K=1000$) | `sparse` | $500$ | Not completed (`> 60 s`) | `3,844.0 ms` |
| $n = 500$ ($K=1000$) | `medium` | $5,000$ | Not completed (`> 60 s`) | `5,149.4 ms` |
| $n = 500$ ($K=1000$) | `dense` | $250,000$ | Not completed (`> 60 s`) | `7,360.3 ms` |
| $n = 500$ ($K=1000$) | `adversarial` | $250,000$ | Not completed (`> 60 s`) | `4,111.8 ms` |
| $n = 1000$ ($K=2000$) | `sparse` | $1,000$ | Not completed (`> 60 s`) | `27,121.2 ms` |
| $n = 1000$ ($K=2000$) | `dense` | $1,000,000$ | Not completed (`> 60 s`) | `56,027.4 ms` |

---

### 8. Proposed Minimal Remediation Patches (Strictly Scoped to `@ai-review/eval`)

1. **`packages/eval/src/types.ts`**:
   - Add `pessimisticF1: number | "N/A"`, `uar: number`, `filteredRecallLoss: number | "N/A"`, and structured `optimisticBounds` / `pessimisticBounds` to `MetricValues`.
2. **`packages/eval/src/matcher.ts`**:
   - Enforce `INPUT_SIZE_LIMIT = 1000` on `candidates` and `expected`.
   - Enforce `Number.isSafeInteger` and $\ge 1$ in `parseCandidateLine`, `parseExpectedLine`, and `checkAntiFindingCompatibility`.
   - Enforce `checkCategoryCompatibility(c.category, a.category).compatible` in `checkAntiFindingCompatibility` when `a.category` is defined.
   - Normalize whitespace symmetrically on `kwNorm` (`.replace(/\s+/g, " ")`), match keywords on token boundaries (`" " + textNorm + " "` includes `" " + kwNorm + " "`), and use `Math.round` for keyword score.
   - Replace `localeCompare` with deterministic UTF-16 code-unit comparison (`a < b ? -1 : a > b ? 1 : 0`).
   - Fix Quadrant III diagonal `matrix[m + j][j] = 0` in `buildAugmentedCostMatrix` and validate all $K$ rows against `penalty` in `solveAugmentedHungarianWeight`.
   - Replace the $O(N^5)$ inner-loop re-solve in `solveMaxWeightLexicographic` with the $O((m+n)^3)$ equality-subgraph Reverse-BFS cycle tie-breaker (`solveHungarianWithDuals`).
3. **`packages/eval/src/metrics.ts`**:
   - Validate duplicate IDs across all 4 input arrays (`deliveredCandidates`, `rejectedCandidates`, `expectedFindings`, `antiFindings`).
   - Implement the 3-step strictly-higher-weight (`W(c, e) > W_Q*(e)`) quarantine & clean matching flow.
   - Compute 1-to-1 bipartite matching (`maxCardinalityMatching`) for `judgeFalseRejectionsClean` and `judgeFalseRejectionsContested`, and populate `uar`, `filteredRecallLoss`, `pessimisticF1`, `optimisticBounds`, and `pessimisticBounds`.
4. **`packages/eval/src/matcher.test.ts` & `packages/eval/src/metrics.test.ts`**:
   - Add unit tests for every defect above plus exhaustive small-graph brute-force oracle comparison tests across random and adversarial tied graphs.
