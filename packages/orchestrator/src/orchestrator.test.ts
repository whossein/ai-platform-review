/**
 * End-to-end review test (composition root).
 *
 * Exercises the full vertical slice with zero external services: diff → shared
 * context slice → specialist agents (via the runtime) → Judge → Markdown/JSON.
 * This is the "does the whole thing actually run?" guardrail.
 */

import { describe, it, expect } from "vitest";
import type { LLMClient, ModelId } from "@ai-review/core";
import {
  ReviewOrchestrator,
  type OrchestratorContext,
  type RunOptions,
  type ReviewResult,
} from "./orchestrator.js";
import { DefaultContextEngine } from "@ai-review/context-engine";
import {
  providersFromEnv,
  CheapestFirstRouter,
  RoutingLLMClient,
  CachingLLMClient,
  MockLLMProvider,
} from "@ai-review/llm";
import {
  MapAgentRegistry,
  DefaultAgentRuntime,
} from "@ai-review/agent-runtime";
import { createDefaultToolRegistry } from "@ai-review/tools";
import { createDefaultSkillRegistry } from "@ai-review/skills";
import { InMemoryMemoryStore } from "@ai-review/memory";
import { DagWorkflowEngine } from "@ai-review/workflow-engine";
import { InMemoryCache, SPECIALISTS, makeSpecialistDefinition, makeSpecialistHandler } from "@ai-review/shared";

const llmCache = new InMemoryCache<any>("llm_response");

/**
 * Test helper: creates a registry with all specialists.
 */
function createTestRegistry(env?: Record<string, string>): MapAgentRegistry {
  const registry = new MapAgentRegistry();
  for (const spec of SPECIALISTS) {
    registry.register({
      definition: makeSpecialistDefinition(spec, env),
      handler: makeSpecialistHandler(spec, env),
    });
  }
  return registry;
}

async function runReview(
  opts: RunOptions & { llm?: LLMClient; registry?: MapAgentRegistry },
): Promise<ReviewResult> {
  const contextEngine = new DefaultContextEngine();
  const envProviders = [
    new MockLLMProvider(),
    ...providersFromEnv(opts.env ?? {}),
  ];
  const router = new CheapestFirstRouter(envProviders);
  const routingCtx = {
    requiredCapabilities: [],
    budget: opts.budget ?? {
      tokenBudget: 1000000,
      dollarBudget: 100,
      executionBudgetMs: 100000,
    },
  };
  const llm =
    opts.llm ??
    new CachingLLMClient(
      new RoutingLLMClient(envProviders, router, routingCtx),
      llmCache,
    );
  const memoryStore = new InMemoryMemoryStore();
  const registry = opts.registry ?? createTestRegistry(opts.env);
  const toolRegistry = createDefaultToolRegistry(process.cwd());
  const skillRegistry = createDefaultSkillRegistry();
  const runtime = new DefaultAgentRuntime(registry, toolRegistry, skillRegistry);
  const pricing = new Map();

  const ctx: OrchestratorContext = {
    contextEngine,
    llm,
    memoryStore,
    registry,
    runtime,
    pricing,
    createWorkflowEngine: (executor, makeBudgetGuard) =>
      new DagWorkflowEngine(executor, makeBudgetGuard as any, undefined, {
        sleep: async () => {},
      }),
  };
  const orchestrator = new ReviewOrchestrator(ctx);
  return orchestrator.review(opts);
}

const DIFF = [
  "+++ b/src/UserList.tsx",
  "@@ -0,0 +1,6 @@",
  '+const API_KEY = "sk-live-abcdef123456";',
  "+export function UserList({ users }: { users: any }) {",
  '+  console.log("rendering", users);',
  "+  return <ul>{users.map((u) => <li>{u.name}</li>)}</ul>;",
  "+}",
].join("\n");

describe("runReview (end-to-end)", () => {
  it("finds security, code, and react issues in a diff and renders reports", async () => {
    const result = await runReview({ diff: DIFF });

    expect(result.total).toBeGreaterThan(0);
    expect(result.accepted).toBeGreaterThan(0);

    // Markdown report is human-readable and leads with the highest-rank issue.
    expect(result.markdown).toContain("# AI Code Review");
    expect(result.markdown).toContain("Hardcoded secret");

    // JSON report is valid and machine-readable.
    const parsed = JSON.parse(result.json) as {
      issues: { category: string }[];
    };
    const categories = new Set(parsed.issues.map((i) => i.category));
    expect(categories.has("security")).toBe(true);
  });

  it("accepts nothing on a clean diff", async () => {
    const clean = "+++ b/ok.ts\n@@ -0,0 +1 @@\n+export const answer = 42;";
    const result = await runReview({ diff: clean });
    expect(result.accepted).toBe(0);
  });

  it("honors the confidence threshold (higher threshold rejects low-confidence findings)", async () => {
    const low = await runReview({ diff: DIFF, confidenceThreshold: 0.5 });
    const high = await runReview({ diff: DIFF, confidenceThreshold: 0.85 });
    expect(high.accepted).toBeLessThanOrEqual(low.accepted);
  });

  it("keeps partial findings when agents cannot run", async () => {
    const failingLlm: LLMClient = {
      complete: async () => ({
        ok: false,
        error: {
          category: "provider",
          code: "llm.budget_exhausted",
          message: "AI budget exhausted",
        },
      }),
    };

    const result = await runReview({
      diff: DIFF,
      llm: failingLlm,

      files: [
        {
          path: "src/UserList.tsx",
          text: [
            'const API_KEY = "sk-live-abcdef123456";',
            "export function UserList({ users }: { users: any }) {",
            '  console.log("rendering", users);',
            "  return <ul>{users.map((u) => <li>{u.name}</li>)}</ul>;",
            "}",
          ].join("\n"),
        },
      ],
    });

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.accepted).toBeGreaterThan(0);
    expect(result.markdown).toContain("agent(s) failed");
    expect(result.issues.some((i) => i.title === "secret.hardcoded")).toBe(
      true,
    );
  });

  it("skips agent stages when pre-execution budget reservation cannot be made", async () => {
    // A tiny token budget of 10 tokens cannot cover the estimated reservation (~1000 tokens)
    const result = await runReview({
      diff: DIFF,
      budget: { tokenBudget: 10, dollarBudget: 1, executionBudgetMs: 30000 },
    });

    expect(
      result.errors.some((e) =>
        e.message.includes("Budget reservation denied"),
      ),
    ).toBe(true);
    expect(result.total).toBeGreaterThan(0);
    expect(result.accepted).toBeGreaterThan(0);
  });

  it("retries transient errors up to maxRetries and succeeds if a later attempt succeeds", async () => {
    let callCount = 0;
    const flakyLlm: LLMClient = {
      complete: async () => {
        callCount++;
        // First 2 calls fail with transient 429 rate limit
        if (callCount <= 2) {
          return {
            ok: false,
            error: {
              category: "provider",
              code: "llm.rate_limited",
              message: "Rate limit exceeded (429)",
              retryable: true,
            },
          };
        }
        // Subsequent calls succeed with valid findings
        return {
          ok: true,
          value: {
            content: JSON.stringify({
              issues: [
                {
                  title: "Transient test issue",
                  description: "Found after retry",
                  severity: "high",
                  confidence: 0.9,
                  file: "src/UserList.tsx",
                  line: 1,
                },
              ],
              confidence: 0.9,
            }),
            model: "mock.model" as ModelId,
            finishReason: "stop",
            usage: { promptTokens: 100, completionTokens: 50 },
          },
        };
      },
    };

    const result = await runReview({
      diff: DIFF,
      llm: flakyLlm,

      selectedSpecialists: ["Security Reviewer"],
      maxRetries: 3,
    });

    expect(callCount).toBeGreaterThan(1);
    expect(result.accepted).toBeGreaterThan(0);
    expect(result.errors.length).toBe(0);
  });

  it("still renders a report and records the error when a specialist always fails transiently", async () => {
    let callCount = 0;
    const alwaysRateLimited: LLMClient = {
      complete: async () => {
        callCount++;
        return {
          ok: false,
          error: {
            category: "provider",
            code: "llm.rate_limited",
            message: "Rate limit exceeded (429)",
            retryable: true,
          },
        };
      },
    };

    const result = await runReview({
      diff: DIFF,
      llm: alwaysRateLimited,
      selectedSpecialists: ["Security Reviewer"],
      maxRetries: 2,
    });

    expect(callCount).toBe(3); // initial + 2 retries
    expect(result.markdown).not.toContain("(no report generated)");
    expect(result.markdown.length).toBeGreaterThan(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain("429");
    expect(result.metrics.agents).toHaveLength(1);
  });

  it("fails fast without retry on non-transient validation/auth errors", async () => {
    let callCount = 0;
    const authFailLlm: LLMClient = {
      complete: async () => {
        callCount++;
        return {
          ok: false,
          error: {
            category: "unauthorized",
            code: "llm.invalid_api_key",
            message: "Invalid API Key (401)",
            retryable: false,
          },
        };
      },
    };

    const result = await runReview({
      diff: DIFF,
      llm: authFailLlm,

      selectedSpecialists: ["Security Reviewer"],
      maxRetries: 3,
    });

    // Should only be called once because 401/unauthorized is non-retryable
    expect(callCount).toBe(1);
    expect(
      result.errors.some((e) => e.message.includes("Invalid API Key")),
    ).toBe(true);
  });

  it("executes a completely generic agent definition without knowing about 'Security' or 'Performance'", async () => {
    // A registry holding ONLY a made-up domain agent — no SPECIALISTS at all.
    // Proves the orchestrator is fully decoupled from concrete specialists.
    const GENERIC_ISSUES = JSON.stringify({
      issues: [
        {
          title: "Generic agent finding",
          description: "a generic agent finding",
          severity: "high",
          confidence: 0.95,
          reason: "generic reason",
          suggestion: "generic suggestion",
          file: "src/UserList.tsx",
          line: 3,
          category: "generic",
        },
      ],
      confidence: 0.95,
      summary: "generic summary",
    });
    const genericLlm: LLMClient = {
      complete: async () => ({
        ok: true as const,
        value: {
          content: GENERIC_ISSUES,
          model: "mock.model" as ModelId,
          finishReason: "stop" as const,
          usage: { promptTokens: 10, completionTokens: 5 },
        },
      }),
    };
    const genericRegistry = new MapAgentRegistry();
    genericRegistry.register({
      definition: {
        id: "agent.generic-reviewer" as never,
        name: "Generic Reviewer",
        goal: "Review anything",
        description: "A made-up domain agent the orchestrator has never seen",
        systemPrompt: "FOCUS:generic",
        allowedTools: [],
        allowedSkills: [],
        outputSchema: {},
        memoryScope: "review",
        priority: 10,
        confidenceThreshold: 0.6,
        temperature: 0,
      },
      handler: {
        run: async (ctx) => {
          const completion = await ctx.llm.complete({
            messages: [{ role: "user", content: ctx.seedSlice?.rendered ?? "" }],
          });
          if (!completion.ok) return { ok: false, error: completion.error };
          const parsed = JSON.parse(completion.value.content) as {
            issues: any[];
            confidence: number;
          };
          return {
            ok: true as const,
            value: {
              agentId: "agent.generic-reviewer" as never,
              issues: parsed.issues.map((f, idx) => ({
                id: `agent.generic-reviewer.${idx}` as never,
                title: f.title,
                description: f.description,
                severity: f.severity,
                confidence: f.confidence,
                reason: f.reason,
                suggestion: { description: f.suggestion },
                location: { file: f.file, line: f.line },
                references: [],
                category: f.category,
                producedBy: "agent.generic-reviewer" as never,
                fingerprint: "deadbeef" as never,
              })),
              confidence: parsed.confidence,
              usage: completion.value.usage,
              model: completion.value.model,
            },
          };
        },
      },
    });

    const result = await runReview({
      diff: DIFF,
      llm: genericLlm,
      registry: genericRegistry,
    });

    // The unknown agent ran to completion and its finding was accepted.
    expect(result.total).toBeGreaterThan(0);
    expect(result.accepted).toBeGreaterThan(0);
    expect(result.issues.some((i) => i.category === "generic")).toBe(true);
    expect(result.markdown).toContain("Generic agent finding");
    // No real specialist ever executed: every issue came from the generic
    // agent or the (free) deterministic rule engine — never an LLM reviewer.
    expect(
      result.issues.every(
        (i) =>
          i.producedBy === "agent.generic-reviewer" ||
          i.producedBy === "agent.rule-engine",
      ),
    ).toBe(true);
  });

  it("registers specialists with Phase 4 capabilities and executes skills in review", async () => {
    const registry = createTestRegistry();
    const contributingSpec = registry.get("agent.contributing-reviewer" as any);
    const securitySpec = registry.get("agent.security-reviewer" as any);
    const reactSpec = registry.get("agent.react-reviewer" as any);

    expect(contributingSpec?.definition.allowedSkills).toContain("skill.governance.contributing-compliance");
    expect(contributingSpec?.definition.allowedSkills).toContain("skill.diff.analyze");
    expect(securitySpec?.definition.allowedSkills).toContain("skill.analysis.imports");
    expect(securitySpec?.definition.allowedSkills).toContain("skill.diff.analyze");
    expect(reactSpec?.definition.allowedSkills).toContain("skill.code.inspect-symbol");
    expect(reactSpec?.definition.allowedTools).toContain("tool.ast.symbols");

    // Run review with specialists selected
    const result = await runReview({
      diff: DIFF,
      selectedSpecialists: ["Contributing & Governance Reviewer", "Security Reviewer"],
    });

    expect(result.errors.length).toBe(0);
    expect(result.metrics.agents.length).toBeGreaterThanOrEqual(2);
  });
});

describe("rule suppression", () => {
  const TWO_FILES = [
    "+++ b/src/a.ts",
    "@@ -0,0 +1 @@",
    '+const API_KEY = "sk-live-abcdef123456";',
    "+++ b/src/b.ts",
    "@@ -0,0 +1 @@",
    '+const API_KEY = "sk-live-abcdef123456";',
  ].join("\n");

  const ruleHits = async (suppressedRules?: RunOptions["suppressedRules"]) => {
    const r = await runReview({
      diff: TWO_FILES,
      ...(suppressedRules ? { suppressedRules } : {}),
    });
    const parsed = JSON.parse(r.json) as {
      issues: { title: string; producedBy?: string; location: { file: string } }[];
    };
    return parsed.issues.filter((i) => i.producedBy === "agent.rule-engine");
  };

  it("drops a suppressed rule only for the scoped file", async () => {
    const all = await ruleHits();
    expect(all.length).toBeGreaterThan(0);
    const { title: ruleId, location } = all[0]!;

    // A different file's suppression leaves the finding in place.
    const other = await ruleHits([{ ruleId, file: "src/unrelated.ts" }]);
    expect(other).toHaveLength(all.length);
    // A different rule id never matches.
    expect(await ruleHits([{ ruleId: "no.such.rule" }])).toHaveLength(all.length);

    const scoped = await ruleHits([{ ruleId, file: location.file }]);
    expect(scoped.some((i) => i.title === ruleId && i.location.file === location.file)).toBe(false);

    const wide = await ruleHits([{ ruleId }]);
    expect(wide.some((i) => i.title === ruleId)).toBe(false);
  });
});

describe("prompt-cache warm-up", () => {
  /** An LLM that records call windows, answering after a short delay. */
  function timedLlm() {
    const windows: Array<{ start: number; end: number }> = [];
    let clock = 0;
    const llm: LLMClient = {
      complete: async () => {
        const w = { start: clock++, end: -1 };
        windows.push(w);
        await new Promise((r) => setTimeout(r, 5));
        w.end = clock++;
        return {
          ok: true,
          value: {
            model: "m" as ModelId,
            content: '{"issues":[],"confidence":0.9,"summary":"ok"}',
            usage: { promptTokens: 0, completionTokens: 0 },
            finishReason: "stop",
          },
        };
      },
    };
    return { llm, windows };
  }
  const bigDiff = [
    "+++ b/src/big.ts",
    "@@ -0,0 +1,300 @@",
    ...Array.from({ length: 300 }, (_, i) => `+export const value${i} = compute(${i});`),
  ].join("\n");
  const specialists = ["Security Reviewer", "Code Reviewer", "TypeScript Reviewer"];

  it("runs one specialist first, then the rest in parallel", async () => {
    const { llm, windows } = timedLlm();
    await runReview({ diff: bigDiff, llm, selectedSpecialists: specialists });
    expect(windows).toHaveLength(3);
    const [first, ...rest] = [...windows].sort((a, b) => a.start - b.start);
    for (const w of rest) expect(w.start).toBeGreaterThan(first!.end);
    // The followers overlap each other (still parallel).
    expect(rest[1]!.start).toBeLessThan(rest[0]!.end);
  });

  it("can be turned off with AI_REVIEW_CACHE_WARMUP=0", async () => {
    const { llm, windows } = timedLlm();
    await runReview({
      diff: bigDiff,
      llm,
      selectedSpecialists: specialists,
      env: { AI_REVIEW_CACHE_WARMUP: "0" },
    });
    const starts = windows.map((w) => w.start).sort((a, b) => a - b);
    const firstEnd = Math.min(...windows.map((w) => w.end));
    expect(starts.filter((s) => s < firstEnd)).toHaveLength(3);
  });
});

describe("project review config (disabled agents and agent instructions)", () => {
  /** An LLM that records every request and answers with an empty, valid review. */
  function recordingLlm() {
    const requests: { messages: { role: string; content: string }[] }[] = [];
    const llm: LLMClient = {
      complete: async (req) => {
        requests.push(req as never);
        return {
          ok: true as const,
          value: {
            content: '{"issues":[],"confidence":0.9,"summary":"ok"}',
            model: "mock.model" as ModelId,
            finishReason: "stop" as const,
            usage: { promptTokens: 10, completionTokens: 5 },
          },
        };
      },
    };
    const focusOf = (r: { messages: { content: string }[] }) =>
      /You are the ([^.\n]+)\. FOCUS:/.exec(r.messages[r.messages.length - 1]!.content)?.[1];
    return { llm, requests, focusOf };
  }
  const agentName = (id: string) => SPECIALISTS.find((s) => s.id === id)!.name;

  it("does not run a disabled agent, after planning and with an explicit selection", async () => {
    const planned = recordingLlm();
    await runReview({ diff: DIFF, llm: planned.llm, disabledAgents: ["agent.react-reviewer"] });
    const plannedNames = planned.requests.map(planned.focusOf);
    expect(plannedNames).toContain(agentName("agent.security-reviewer"));
    expect(plannedNames).not.toContain(agentName("agent.react-reviewer"));

    const explicit = recordingLlm();
    await runReview({
      diff: DIFF,
      llm: explicit.llm,
      selectedSpecialists: [agentName("agent.react-reviewer"), agentName("agent.code-reviewer")],
      disabledAgents: ["agent.react-reviewer"],
    });
    expect(explicit.requests.map(explicit.focusOf)).toEqual([agentName("agent.code-reviewer")]);
  });

  it("never removes the security reviewer, even if asked", async () => {
    const rec = recordingLlm();
    await runReview({ diff: DIFF, llm: rec.llm, disabledAgents: ["agent.security-reviewer"] });
    expect(rec.requests.map(rec.focusOf)).toContain(agentName("agent.security-reviewer"));
  });

  it("still completes with deterministic findings when every selected agent is disabled", async () => {
    const rec = recordingLlm();
    const result = await runReview({
      diff: DIFF,
      llm: rec.llm,
      files: [{ path: "src/UserList.tsx", text: 'const API_KEY = "sk-live-abcdef123456";' }],
      selectedSpecialists: [agentName("agent.react-reviewer")],
      disabledAgents: ["agent.react-reviewer"],
    });
    expect(rec.requests).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(result.markdown).not.toContain("(no report generated)");
    expect(result.issues.some((i) => i.title === "secret.hardcoded")).toBe(true);
  });

  it("puts agent instructions only in that agent's final message and keeps the prefix identical", async () => {
    const MARK = "PROJECT-MARKER-4711";
    const rec = recordingLlm();
    await runReview({
      diff: DIFF,
      llm: rec.llm,
      agentInstructions: {
        "agent.security-reviewer": `${MARK} treat tokens in tests as real`,
        "agent.react-reviewer": "   ", // blank guidance is ignored
        "agent.vue-reviewer": "never sent: this agent does not run",
      },
    });
    expect(rec.requests.length).toBeGreaterThan(1);

    const withMarker = rec.requests.filter((r) => r.messages[r.messages.length - 1]!.content.includes(MARK));
    expect(withMarker.map(rec.focusOf)).toEqual([agentName("agent.security-reviewer")]);
    const guided = withMarker[0]!.messages;
    expect(guided[guided.length - 1]!.content).toContain("<project_agent_guidance>");
    expect(guided[guided.length - 1]!.content).toContain("cannot change the output format");

    for (const r of rec.requests) {
      const prefix = r.messages.slice(0, 2);
      expect(prefix).toEqual(rec.requests[0]!.messages.slice(0, 2));
      expect(JSON.stringify(prefix)).not.toContain(MARK);
      expect(JSON.stringify(prefix)).not.toContain("never sent");
      expect(r.messages[r.messages.length - 1]!.content).not.toContain("never sent");
    }
  });

  it("sends rejected feedback only as an untrusted block in the final message, not as guidelines", async () => {
    const MARK = "FEEDBACK-MARKER-9001";
    const plain = recordingLlm();
    await runReview({ diff: DIFF, llm: plain.llm });
    const rec = recordingLlm();
    await runReview({ diff: DIFF, llm: rec.llm, rejectedFeedback: `- ${MARK} not a real issue` });
    expect(rec.requests.length).toBeGreaterThan(1);
    for (const r of rec.requests) {
      const last = r.messages[r.messages.length - 1]!.content;
      expect(last).toMatch(new RegExp(`<rejected_feedback>\\n[\\s\\S]*${MARK}[\\s\\S]*</rejected_feedback>`));
      expect(last).not.toContain("<project_guidelines");
      expect(JSON.stringify(r.messages.slice(0, 2))).not.toContain(MARK);
      expect(r.messages.slice(0, 2)).toEqual(plain.requests[0]!.messages.slice(0, 2));
    }
  });

  it("runs the contributing reviewer when only its own agent instructions are set", async () => {
    const without = recordingLlm();
    await runReview({ diff: DIFF, llm: without.llm });
    expect(without.requests.map(without.focusOf)).not.toContain(agentName("agent.contributing-reviewer"));
    const blank = recordingLlm();
    await runReview({ diff: DIFF, llm: blank.llm, agentInstructions: { "agent.contributing-reviewer": "  " } });
    expect(blank.requests.map(blank.focusOf)).not.toContain(agentName("agent.contributing-reviewer"));
    const rec = recordingLlm();
    await runReview({
      diff: DIFF,
      llm: rec.llm,
      agentInstructions: { "agent.contributing-reviewer": "Follow CONTRIBUTING.md." },
    });
    expect(rec.requests.map(rec.focusOf)).toContain(agentName("agent.contributing-reviewer"));
  });
});
