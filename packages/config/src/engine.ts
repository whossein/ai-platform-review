/**
 * Deterministic Rule Engine (ADR-0006).
 *
 * Runs all registered rules before any AI, aggregates their findings, and
 * reports which rule kinds produced findings. Nothing uses that to skip
 * specialist agents: a rule hit never replaces an AI review.
 */

import type {
  Rule,
  RuleContext,
  RuleEngine,
  RuleEngineResult,
  RuleFinding,
  RuleKind,
  RuleRegistry,
} from "@ai-review/core";

/** Map-backed rule registry (dynamic registration, ADR-0003 style). */
export class MapRuleRegistry implements RuleRegistry {
  private readonly rules: Rule[] = [];

  register(rule: Rule): void {
    this.rules.push(rule);
  }

  list(): readonly Rule[] {
    return this.rules;
  }
}

/**
 * Runs registered rules and folds their output into a `RuleEngineResult`.
 * `coveredConcerns` lists the rule kinds that produced at least one finding
 * (informational only).
 */
export class DefaultRuleEngine implements RuleEngine {
  constructor(private readonly registry: RuleRegistry) {}

  async run(ctx: RuleContext) {
    const findings: RuleFinding[] = [];
    for (const rule of this.registry.list()) {
      const res = await rule.run(ctx);
      if (res.ok) findings.push(...res.value);
    }
    const coveredConcerns = [
      ...new Set(findings.map((f) => f.ruleKind)),
    ] as RuleKind[];
    const result: RuleEngineResult = { findings, coveredConcerns };
    return { ok: true as const, value: result };
  }
}
