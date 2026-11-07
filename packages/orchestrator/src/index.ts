/**
 * @ai-review/orchestrator
 *
 * The review composition root, extracted so every surface — CLI, HTTP API, Web,
 * and Desktop — runs the *same* pipeline instead of each re-implementing it:
 *
 *   Rule Engine → Planner (smart routing) → specialist agents (parallel) →
 *   Critic (consolidation) → Judge → Markdown/JSON report.
 *
 * Apps depend on this package; this package depends only on inward packages
 * (ADR-0002), so there is no app→app coupling.
 */

export {
  ReviewOrchestrator,
  type OrchestratorContext,
  type RunOptions,
  type ReviewResult,
} from "./orchestrator.js";
export { runReview } from "./pipeline.js";
export {
  plan,
  changedFiles,
  type PlanInput,
  type ReviewPlan,
} from "./planner.js";
export { critique, type CritiquedIssue } from "./critic.js";
export {
  DefaultRuleEngine,
  MapRuleRegistry,
  DEFAULT_RULES,
  ruleFindingToIssue,
  RULE_ENGINE_AGENT,
  ruleLanguageFromEnv,
  type FileRuleContext,
} from "@ai-review/config";
export { resolveProviderPreset, PROVIDER_CATALOG } from "@ai-review/llm";
