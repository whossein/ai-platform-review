import type { IssueCategory, Severity } from "@ai-review/core";

export type BenchmarkOrigin =
  | "synthetic_unit"
  | "historical_mr"
  | "human_verified_feed";

export type GroundTruthStatus = "unverified" | "peer_reviewed" | "verified";

export interface ExpectedFinding {
  id: string;
  file: string;
  lineRange: [number, number];
  category: IssueCategory;
  severity: Severity;
  requiredKeywords: string[];
  forbiddenKeywords?: string[];
  description: string;
  sourceMrId?: string;
}

export interface AntiFinding {
  id: string;
  file: string;
  lineRange: [number, number];
  category?: IssueCategory;
  triggerKeywords: string[];
  explanation: string;
}

export interface BenchmarkCase {
  id: string;
  name: string;
  origin: BenchmarkOrigin;
  status: GroundTruthStatus;
  datasetVersion: string;
  annotationVersion: string;
  tags: string[];
  inputFiles: Array<{
    path: string;
    content: string;
  }>;
  diff: string;
  expectedFindings: ExpectedFinding[];
  antiFindings: AntiFinding[];
}

export interface CandidateFinding {
  id: string;
  title: string;
  description: string;
  reason: string;
  suggestion?: string;
  location: {
    file: string;
    line?: number;
    endLine?: number;
  };
  category: IssueCategory;
  severity: Severity;
  accepted?: boolean;
  producedBy?: string;
}

export interface MatchedPair {
  candidateId: string;
  expectedId: string;
  weight: number;
}

export interface MatchingResult {
  matches: MatchedPair[];
  unmatchedCandidates: string[];
  unmatchedExpected: string[];
  totalWeight: number;
}

export interface MetricCounts {
  tp: number;
  fp: number;
  fpTrap: number;
  fpSpurious: number;
  fn: number;
  q: number;
  uq: number;
  totalDelivered: number;
  totalExpected: number;
  totalAntiFindings: number;
}

export interface MetricBound {
  precision: number;
  recall: number | "N/A";
  f1: number | "N/A";
}

export interface MetricValues {
  confirmedPrecision: number;
  conservativePrecision: number;
  conservativeRecall: number | "N/A";
  conservativeF1: number | "N/A";
  optimisticPrecision: number;
  optimisticRecall: number | "N/A";
  optimisticF1: number | "N/A";
  pessimisticPrecision: number;
  pessimisticRecall: number | "N/A";
  pessimisticF1: number | "N/A";
  optimisticBounds: MetricBound;
  pessimisticBounds: MetricBound;
  aftr: number | "N/A";
  fdpc: number;
  uar: number;
  filteredRecallLoss: number | "N/A";
}

export interface StageDiagnostics {
  specialistRecall: "N/A";
  criticFilterRate: "N/A";
  judgeFalseRejectionsClean: number;
  judgeFalseRejectionsContested: number;
  judgeFalseRejectionsTotal: number;
  judgeTotalRejections: number;
}

export interface EvaluationReport {
  caseId: string;
  status: "COMPLETE" | "PENDING_HUMAN_ADJUDICATION";
  counts: MetricCounts;
  metrics: MetricValues;
  diagnostics: StageDiagnostics;
}
