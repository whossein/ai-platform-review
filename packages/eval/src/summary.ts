import type { EvaluationReport, MetricCounts } from "./types.js";

export type Ratio = number | "N/A";

export interface AggregateScores {
  cases: number;
  tp: number;
  fp: number;
  fn: number;
  delivered: number;
  expected: number;
  /** tp / delivered, micro-averaged over cases. */
  precision: Ratio;
  /** tp / expected, micro-averaged over cases. */
  recall: Ratio;
}

export function ratio(num: number, den: number): Ratio {
  return den === 0 ? "N/A" : num / den;
}

export function pct(v: Ratio): string {
  return v === "N/A" ? "N/A" : `${(v * 100).toFixed(1)}%`;
}

export function aggregateCounts(
  reports: readonly Pick<EvaluationReport, "counts">[],
): AggregateScores {
  const sum = (k: keyof MetricCounts) =>
    reports.reduce((n, r) => n + r.counts[k], 0);
  const tp = sum("tp");
  const delivered = sum("totalDelivered");
  const expected = sum("totalExpected");
  return {
    cases: reports.length,
    tp,
    fp: sum("fp"),
    fn: sum("fn"),
    delivered,
    expected,
    precision: ratio(tp, delivered),
    recall: ratio(tp, expected),
  };
}

export function formatAggregate(label: string, a: AggregateScores): string {
  return (
    `${label}: cases=${a.cases} delivered=${a.delivered} expected=${a.expected} ` +
    `TP=${a.tp} FP=${a.fp} FN=${a.fn} precision=${pct(a.precision)} recall=${pct(a.recall)}`
  );
}
