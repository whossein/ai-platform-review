import { describe, it, expect } from "vitest";
import { normalizeModels } from "./models.js";

describe("normalizeModels", () => {
  it("converts OpenRouter per-token pricing to per-1M", () => {
    const [m] = normalizeModels([
      { id: "a/b", name: "A B", context_length: 8000, pricing: { prompt: "0.000003", completion: "0.000015" } },
    ]);
    expect(m).toEqual({ id: "a/b", name: "A B", inputCostPer1M: 3, outputCostPer1M: 15, contextLength: 8000 });
  });

  it("keeps per-1M pricing (Together) and strips Gemini prefix", () => {
    const out = normalizeModels([
      { id: "t/x", pricing: { input: 0.88, output: 0.9 } },
      { name: "models/gemini-1.5-flash", inputTokenLimit: 1000000 },
    ]);
    expect(out.find((m) => m.id === "t/x")).toMatchObject({ inputCostPer1M: 0.88, outputCostPer1M: 0.9 });
    expect(out.find((m) => m.id === "gemini-1.5-flash")?.contextLength).toBe(1000000);
  });

  it("handles plain strings, dedupes and omits missing prices", () => {
    const out = normalizeModels(["gpt-4o", "gpt-4o", { id: "x", pricing: { prompt: "-1" } }]);
    expect(out.map((m) => m.id)).toEqual(["gpt-4o", "x"]);
    expect(out[0]).toEqual({ id: "gpt-4o" });
  });
});
