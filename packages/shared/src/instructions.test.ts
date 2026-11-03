import { describe, expect, it } from "vitest";
import { instructionsForAgent, splitInstructionSections } from "./instructions.js";

const TEXT = `Always answer in Persian.

## Security
- Never hardcode secrets.

## Performance
- No queries inside loops.

## Git & Commits
- Use Conventional Commits.

## React Hooks
- Keep deps exhaustive.

## Notes [security, testing]
- Mock auth in tests.

Learned from reviewer feedback:
- Ignore console.log in CLI`;

describe("instructionsForAgent", () => {
  it("splits on headings and tags topics", () => {
    const sections = splitInstructionSections(TEXT);
    expect(sections.find((s) => s.heading === "## Security")?.topics).toEqual(["security"]);
    expect(sections.find((s) => s.heading === "## Notes [security, testing]")?.topics).toEqual(["security", "testing"]);
    expect(sections[0]!.topics).toEqual([]);
  });

  it("sends each specialist only its sections plus general ones", () => {
    const security = instructionsForAgent(TEXT, "agent.security-reviewer");
    expect(security).toContain("Always answer in Persian");
    expect(security).toContain("Never hardcode secrets");
    expect(security).toContain("Mock auth in tests");
    expect(security).not.toContain("Conventional Commits");
    expect(security).not.toContain("queries inside loops");
    // Learned rules sit in their own general section, not under the last heading.
    expect(security).toContain("Ignore console.log in CLI");
  });

  it("routes framework and governance sections", () => {
    expect(instructionsForAgent(TEXT, "agent.react-reviewer")).toContain("deps exhaustive");
    expect(instructionsForAgent(TEXT, "agent.contributing-reviewer")).toContain("Conventional Commits");
    expect(instructionsForAgent(TEXT, "agent.performance-reviewer")).not.toContain("Never hardcode");
  });

  it("gives the catch-all reviewer framework rules and unknown agents everything", () => {
    expect(instructionsForAgent(TEXT, "agent.code-reviewer")).toContain("deps exhaustive");
    expect(instructionsForAgent(TEXT, "agent.custom-plugin")).toBe(TEXT.trim());
  });

  it("returns an empty string without instructions", () => {
    expect(instructionsForAgent(undefined, "agent.code-reviewer")).toBe("");
  });
});
