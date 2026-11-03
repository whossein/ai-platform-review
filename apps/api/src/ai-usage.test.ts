import { describe, it, expect } from "vitest";
import { estimateAiUsage, ruleSignals, parseJudgeReply, levelOf } from "./ai-usage.js";

const plainDiff = "+++ b/a.ts\n+const a = 1;\n";

describe("ai-usage", () => {
  it("treats an AI Co-Authored-By trailer as strong evidence", () => {
    const r = ruleSignals({
      commitMessages: ["feat: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>"],
      diff: plainDiff,
    });
    expect(r.score).toBeGreaterThanOrEqual(90);
    expect(r.signals[0]?.hard).toBe(true);
  });

  it("scores plain code low and caps soft signals", async () => {
    const res = await estimateAiUsage({ commitMessages: ["fix bug"], diff: plainDiff });
    expect(res.level).toBe("low");
    expect(res.method).toBe("rules");
  });

  it("flags heavy comment density as a soft signal", () => {
    const lines = Array.from({ length: 40 }, (_, i) => (i % 2 ? "+// explain step" : "+code();")).join("\n");
    const r = ruleSignals({ commitMessages: [], diff: `+++ b/a.ts\n${lines}` });
    expect(r.signals.some((s) => /comment density/.test(s.label))).toBe(true);
    expect(r.score).toBeLessThanOrEqual(60);
  });

  it("blends rules and the AI judge", async () => {
    const res = await estimateAiUsage(
      { commitMessages: ["fix"], diff: plainDiff },
      async () => '{"percent": 80, "reasons": ["uniform comments"]}',
    );
    expect(res.method).toBe("rules+ai");
    expect(res.percent).toBe(52);
    expect(res.reasons).toContain("AI: uniform comments");
  });

  it("falls back to rules when the judge fails or is unreadable", async () => {
    const boom = await estimateAiUsage({ commitMessages: [], diff: plainDiff }, async () => {
      throw new Error("x");
    });
    expect(boom.method).toBe("rules");
    expect(parseJudgeReply("nope")).toBeUndefined();
  });

  it("maps levels", () => {
    expect([levelOf(10), levelOf(50), levelOf(90)]).toEqual(["low", "medium", "high"]);
  });
});
