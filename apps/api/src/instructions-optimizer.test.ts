import { describe, expect, it } from "vitest";
import { buildOptimizePrompt, compactLearnedRule, dropEmptySections, optimizeInstructions } from "./instructions-optimizer.js";

describe("optimizeInstructions", () => {
  it("parses the JSON reply (even when fenced) and reports token counts", async () => {
    const reply = '```json\n{"improved":"## Security\\n- No secrets in code.","compact":"## Security\\n- No secrets"}\n```';
    const out = await optimizeInstructions("never ever put secrets in the code please", async () => reply);
    expect(out.improved).toContain("## Security");
    expect(out.compact.length).toBeLessThan(out.improved.length);
    expect(out.tokens.original).toBeGreaterThan(0);
  });

  it("falls back to the improved text when compact is missing or longer", async () => {
    const out = await optimizeInstructions("x", async () => '{"improved":"## General\\n- a","compact":"## General\\n- a much longer text"}');
    expect(out.compact).toBe(out.improved);
  });

  it("rejects unusable replies and empty input", async () => {
    await expect(optimizeInstructions("rules", async () => "not json")).rejects.toThrow(/usable/);
    await expect(optimizeInstructions("  ", async () => "{}")).rejects.toThrow(/no guidelines/);
  });

  it("asks for English only when requested", () => {
    expect(buildOptimizePrompt("x", { english: true }).system).toContain("clear English");
    expect(buildOptimizePrompt("x").system).toContain("original language");
  });

  it("keeps learned 'Do not report' rules verbatim and files them by category", async () => {
    const input = `Always answer in Persian.

Learned from reviewer feedback:
- Do not report "feature flag is not a security control" (authorization) in this project: client-side only.
- Do not report "governance.require-release-change" (governance) in this project: a release-note file is enough.`;
    let sentToAi = "";
    const out = await optimizeInstructions(input, async ({ user }) => {
      sentToAi = user;
      return '{"improved":"## General\\n- Answer in Persian.\\n\\n## Security\\n- No secrets.","compact":"## General\\n- Persian\\n\\n## Security\\n- No secrets"}';
    });
    // The AI never sees (or rewrites) the machine-written rules.
    expect(sentToAi).not.toContain("Do not report"); // without translation they are untouched
    expect(out.improved).toContain('- Do not report "feature flag is not a security control" (authorization) in this project: client-side only.');
    const security = out.improved.split("## Security")[1]!.split("##")[0]!;
    expect(security).toContain("feature flag is not a security control");
    expect(out.improved).toContain("## Git & Commits\n- Do not report \"governance.require-release-change\"");
    expect(out.compact).toContain("governance.require-release-change");
    expect(out.improved).not.toContain("Learned from reviewer feedback");
  });

  it("works when the text is only learned rules (no AI call)", async () => {
    const out = await optimizeInstructions('- Do not report "x" (style) in this project.', async () => {
      throw new Error("should not be called");
    });
    expect(out.improved).toBe('## Style & Naming\n- Do not report "x" (style) in this project.');
  });

  it("translates learned rules to English when asked, keeping category and routing", async () => {
    const input = `Learned from reviewer feedback:
- Do not report "استفاده از feature flag مجاز نیست" (authorization) in this project: فقط سمت کلاینت است.
- Do not report "governance.require-release-change" (governance) in this project — فایل release-note کافی است.`;
    let sent = "";
    const out = await optimizeInstructions(
      input,
      async ({ user }) => {
        sent = user;
        return JSON.stringify({
          rules: [
            '- Do not report "using a feature flag is not allowed" (authorization) in this project: client-side only.',
            '- Do not report "governance.require-release-change" (governance) in this project: a release-note file is enough.',
          ],
        });
      },
      { english: true },
    );
    expect(sent).toContain("LEARNED RULES");
    expect(out.improved).toContain('## Security\n- Do not report "using a feature flag is not allowed" (authorization)');
    expect(out.improved).toContain("## Git & Commits");
    expect(out.improved).not.toMatch(/[\u0600-\u06FF]/);
  });

  it("keeps the original rules when the translated list is malformed", async () => {
    const out = await optimizeInstructions(
      '- Do not report "x" (style) in this project: دلیل.',
      async () => '{"rules":["wrong"]}',
      { english: true },
    );
    expect(out.improved).toContain("دلیل");
  });

  it("shortens learned rules for the compact version only", async () => {
    const line =
      '- Do not report "governance.require-release-change" (governance) in this project: this is an intentional project convention — a release-note file is enough.';
    expect(compactLearnedRule(line)).toBe(
      '- Do not report "governance.require-release-change" (governance): a release-note file is enough',
    );
    expect(compactLearnedRule('- Do not report "x" (style) in this project.')).toBe('- Do not report "x" (style)');

    const out = await optimizeInstructions(line, async () => "{}");
    expect(out.improved).toContain("intentional project convention");
    expect(out.compact).not.toContain("intentional project convention");
    expect(out.tokens.compact).toBeLessThan(out.tokens.improved);
  });

  it("does not duplicate rules when re-optimizing already optimized text", async () => {
    const rule = '- Do not report "x" (authorization) in this project: client-side only.';
    const input = `## Security\n${rule}\n\n## Performance\n- No queries in loops.`;
    // The AI echoes the rule inside its own output as well as in "rules".
    const reply = JSON.stringify({
      improved: `## Security\n${rule}\n\n## Performance\n- No queries in loops.`,
      compact: `## Security\n${rule}\n\n## Performance\n- No queries in loops`,
      rules: [rule],
    });
    const out = await optimizeInstructions(input, async () => reply, { english: true });
    expect(out.improved.split("Do not report").length - 1).toBe(1);
    expect(out.compact.split("Do not report").length - 1).toBe(1);
    expect(out.improved).toContain("## Performance");
  });

  it("drops headings left empty", () => {
    expect(dropEmptySections("## A\n\n## B\n- x")).toBe("## B\n- x");
  });
});
