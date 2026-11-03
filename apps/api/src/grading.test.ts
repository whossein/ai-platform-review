import { describe, it, expect } from "vitest";
import { suggestGrade } from "./grading.js";

describe("suggestGrade", () => {
  it("gives 100 when nothing accepted", () => {
    expect(suggestGrade([{ severity: "high", accepted: false }]).score).toBe(10);
  });
  it("deducts per severity and explains why", () => {
    const g = suggestGrade([
      { severity: "critical", accepted: true },
      { severity: "medium", accepted: true },
      { severity: "medium", accepted: true },
    ]);
    expect(g.score).toBe(6);
    expect(g.reason).toContain("1 critical");
    expect(g.reason).toContain("2 medium");
  });
  it("never goes below 1", () => {
    const many = Array.from({ length: 10 }, () => ({ severity: "critical", accepted: true }));
    expect(suggestGrade(many).score).toBe(1);
  });
});
