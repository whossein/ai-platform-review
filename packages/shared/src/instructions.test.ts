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

describe("topic routing boundaries", () => {
  const topics = (h: string) => splitInstructionSections(`## ${h}\nx`)[0]!.topics;

  it("does not match topics inside unrelated words", () => {
    for (const h of ["Formatting", "Platform notes", "Information", "Authors", "Player rules", "Infrastructure", "Network"]) {
      expect(topics(h)).not.toContain("database");
      expect(topics(h)).not.toContain("security");
      expect(topics(h)).not.toContain("architecture");
    }
    expect(topics("Information")).not.toContain("style");
    expect(topics("Network")).not.toContain("dotnet");
  });

  it("still matches the real topics", () => {
    expect(topics("ORM usage")).toContain("database");
    expect(topics("Auth rules")).toContain("security");
    expect(topics("Authorization")).toContain("security");
    expect(topics("Formatting")).toContain("style");
    expect(topics("Layers")).toContain("architecture");
    expect(topics("Hooks")).toContain("react");
  });

  it("routes git hooks to governance, not react", () => {
    expect(topics("Git hooks")).toContain("governance");
    expect(topics("Git hooks")).not.toContain("react");
  });
});

describe("instructionsForAgent with activeAgentIds", () => {
  const text = "## Security\nsec rule\n\n## Python\npy rule\n\n## General\ng rule";

  it("is unchanged without the parameter", () => {
    expect(instructionsForAgent(text, "agent.code-reviewer")).not.toContain("sec rule");
  });

  it("gives the code reviewer sections no running specialist accepts", () => {
    const out = instructionsForAgent(text, "agent.code-reviewer", ["agent.code-reviewer", "agent.python-reviewer"]);
    expect(out).toContain("sec rule");
    expect(out).toContain("py rule");
    expect(out).toContain("g rule");
  });

  it("does not duplicate sections a running specialist already covers", () => {
    const out = instructionsForAgent(text, "agent.code-reviewer", ["agent.code-reviewer", "agent.security-reviewer"]);
    expect(out).not.toContain("sec rule");
  });

  it("does not affect other specialists", () => {
    expect(instructionsForAgent(text, "agent.python-reviewer", ["agent.python-reviewer"])).not.toContain("sec rule");
  });
});
