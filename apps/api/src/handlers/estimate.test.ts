import { describe, it, expect } from "vitest";
import { MapAgentRegistry } from "@ai-review/agent-runtime";
import { SPECIALISTS, makeSpecialistDefinition } from "@ai-review/shared";
import { estimateHandler } from "./estimate.js";

const DIFF = `--- a/app/util.py
+++ b/app/util.py
@@ -1,2 +1,3 @@
 print("old line")
+import os
+print(os.getcwd())
`;

function registry(): MapAgentRegistry {
  const reg = new MapAgentRegistry();
  for (const id of ["agent.security-reviewer", "agent.code-reviewer", "agent.performance-reviewer"]) {
    const spec = SPECIALISTS.find((s) => s.id === id)!;
    reg.register({ definition: makeSpecialistDefinition(spec) });
  }
  return reg;
}

const PER_AGENT_IN = Math.ceil(DIFF.length / 4) + 600;
const PER_AGENT_OUT = 1000;
const cost = (i: number, o: number) =>
  (PER_AGENT_IN / 1e6) * i + (PER_AGENT_OUT / 1e6) * o;

describe("estimateHandler routing-aware pricing", () => {
  it("prices each agent at its routed model, not the active rate", async () => {
    const providers = [
      { id: "a", provider: "openai", model: "mid-model", tier: "mid", inputCostPer1M: 1, outputCostPer1M: 2 },
      { id: "b", provider: "openai", model: "premium-model", tier: "premium", inputCostPer1M: 10, outputCostPer1M: 20 },
      { id: "c", provider: "openai", model: "cheap-model", tier: "cheap", inputCostPer1M: 0.1, outputCostPer1M: 0.2 },
    ];
    const res = await estimateHandler(
      {
        diff: DIFF,
        env: {
          AI_REVIEW_LLM_PROVIDER: "openai",
          AI_REVIEW_ACTIVE_PROVIDER_ID: "a",
          AI_PROVIDERS_JSON: JSON.stringify(providers),
        },
      },
      registry(),
    );
    const byAgent = Object.fromEntries((res.agentRouting ?? []).map((r) => [r.agent, r.model]));
    expect(byAgent["Security Reviewer"]).toBe("premium-model");
    expect(byAgent["Code Reviewer"]).toBe("cheap-model");
    expect(byAgent["Performance Reviewer"]).toBe("mid-model");
    expect(res.totalAgents).toBe(3);

    const expected = cost(10, 20) + cost(0.1, 0.2) + cost(1, 2);
    expect(res.estimatedCostUsd).toBeCloseTo(expected, 4);
    // Not active rate (mid) times agent count.
    expect(res.estimatedCostUsd).not.toBeCloseTo(3 * cost(1, 2), 4);
    expect(res.inputCostPer1M).toBeCloseTo((10 + 0.1 + 1) / 3, 6);
    expect(res.outputCostPer1M).toBeCloseTo((20 + 0.2 + 2) / 3, 6);
  });

  it("keeps legacy single-provider pricing and its overrides", async () => {
    const res = await estimateHandler(
      {
        diff: DIFF,
        env: {
          AI_REVIEW_LLM_PROVIDER: "openai",
          AI_REVIEW_INPUT_COST_PER_1M: "2",
          AI_REVIEW_OUTPUT_COST_PER_1M: "4",
        },
      },
      registry(),
    );
    expect(res.agentRouting).toBeUndefined();
    expect(res.inputCostPer1M).toBe(2);
    expect(res.outputCostPer1M).toBe(4);
    expect(res.estimatedCostUsd).toBeCloseTo(3 * cost(2, 4), 4);
  });

  it("is free for mock", async () => {
    const res = await estimateHandler(
      { diff: DIFF, env: { AI_REVIEW_LLM_PROVIDER: "mock" } },
      registry(),
    );
    expect(res.estimatedCostUsd).toBe(0);
    expect(res.agentRouting).toBeUndefined();
  });
});
