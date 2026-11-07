import { describe, it, expect } from "vitest";
import { parseArgs, assessRunValidity } from "./live-cli.js";

describe("parseArgs --pace-ms", () => {
  it("defaults to 0", () => {
    expect(parseArgs([]).paceMs).toBe(0);
  });
  it("parses both forms", () => {
    expect(parseArgs(["--pace-ms", "1500"]).paceMs).toBe(1500);
    expect(parseArgs(["--pace-ms=2000", "--output=x.json"])).toMatchObject({
      paceMs: 2000,
      output: "x.json",
    });
  });
  it("rejects missing, non-numeric and negative values", () => {
    expect(() => parseArgs(["--pace-ms"])).toThrow(/pace-ms/);
    expect(() => parseArgs(["--pace-ms=abc"])).toThrow(/pace-ms/);
    expect(() => parseArgs(["--pace-ms", "-5"])).toThrow(/pace-ms/);
    expect(() => parseArgs(["--pace-ms="])).toThrow(/pace-ms/);
  });
});

describe("assessRunValidity", () => {
  it("is valid when nothing errored", () => {
    expect(assessRunValidity([{ errors: [] }, {}])).toEqual({ valid: true, agentErrorCount: 0 });
  });
  it("counts agent errors and thrown cases", () => {
    expect(assessRunValidity([{ errors: [1, 2] }, { threw: true }, { errors: [] }])).toEqual({
      valid: false,
      agentErrorCount: 3,
    });
  });
});
