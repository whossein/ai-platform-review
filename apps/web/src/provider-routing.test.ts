import { describe, it, expect } from "vitest";
import { effectiveTier, routingNotices } from "./provider-routing.js";

const p = (id: string, model: string, tier?: string, extra = {}) => ({
  id,
  provider: "openai",
  model,
  tier,
  ...extra,
});

describe("routingNotices", () => {
  it("is silent with fewer than two enabled providers", () => {
    expect(routingNotices([p("a", "m")], "a")).toEqual([]);
    expect(
      routingNotices([p("a", "m"), p("b", "n", "mid", { enabled: false })], "a"),
    ).toEqual([]);
  });

  it("warns when premium and mid are missing and names the default", () => {
    const n = routingNotices([p("a", "m1", "cheap"), p("b", "m2", "cheap")], "b");
    const texts = n.map((x) => x.text);
    expect(texts[0]).toContain("Security Reviewer will use the default provider (m2)");
    expect(texts[1]).toContain("most reviewers will use the default provider (m2)");
    expect(n[n.length - 1]!.text).toContain("failover");
  });

  it("no tier warnings when premium and mid exist", () => {
    const n = routingNotices([p("a", "m1", "mid"), p("b", "m2", "premium")], "a");
    expect(n).toHaveLength(1);
    expect(n[0]!.kind).toBe("info");
  });

  it("flags duplicate model ids", () => {
    const n = routingNotices([p("a", "same", "mid"), p("b", "same", "premium")], "b");
    expect(n.some((x) => x.text.includes('both use model "same"'))).toBe(true);
  });

  it("treats a missing tier like the server preset default", () => {
    expect(effectiveTier(p("a", "m"))).toBe("cheap");
    expect(effectiveTier({ ...p("a", "m"), provider: "openrouter" })).toBe("mid");
  });
});
