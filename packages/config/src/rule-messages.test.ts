import { describe, expect, it } from "vitest";
import { DefaultRuleEngine, MapRuleRegistry } from "./engine.js";
import { RULE_MESSAGES, ruleLanguageFromEnv, ruleMessage, toRuleLanguage } from "./rule-messages.js";
import { DEFAULT_RULES, GOVERNANCE_RULES, type FileRuleContext } from "./rules.js";

const PERSIAN = /[؀-ۿ]/;

async function run(path: string, text: string, language?: string) {
  const registry = new MapRuleRegistry();
  for (const r of [...DEFAULT_RULES, ...GOVERNANCE_RULES]) registry.register(r);
  const ctx: FileRuleContext = {
    repositoryId: "r",
    files: [{ path, text }],
    projectInstructions: "Every change must update the CHANGELOG.",
    ...(language ? { language } : {}),
  };
  const res = await new DefaultRuleEngine(registry).run(ctx);
  return res.ok ? res.value.findings : [];
}

describe("rule message localization", () => {
  const samples: [string, string, string][] = [
    ["no-alert", "src/a.ts", "alert('hi');"],
    ["no-eval", "src/a.ts", "eval(code);"],
    ["security.js-command-exec", "src/a.ts", "import cp from 'child_process';\ncp.exec(`ls ${dir}`);"],
    ["governance.require-release-change", "src/a.ts", "export const x = 1;"],
  ];

  for (const [ruleId, path, text] of samples) {
    it(`${ruleId}: English by default, Persian for fa`, async () => {
      const en = (await run(path, text)).find((f) => f.ruleId === ruleId);
      const fa = (await run(path, text, "fa")).find((f) => f.ruleId === ruleId);
      expect(en?.message).toBeDefined();
      expect(en!.message).not.toMatch(PERSIAN);
      expect(fa!.message).toMatch(PERSIAN);
      expect(fa!.message).not.toBe(en!.message);
    });
  }

  it("keeps dynamic parts", () => {
    expect(ruleMessage("governance.branch-naming", "en", { branch: "bad" })).toContain('"bad"');
    expect(ruleMessage("governance.branch-naming", "fa", { branch: "bad" })).toContain("bad");
    expect(ruleMessage("governance.commit-convention", "fa", { title: "oops" })).toContain("oops");
  });

  it("maps languages robustly", () => {
    expect(toRuleLanguage("Persian (Farsi)")).toBe("fa");
    expect(toRuleLanguage("fa")).toBe("fa");
    expect(toRuleLanguage("English")).toBe("en");
    expect(toRuleLanguage("German")).toBe("en");
    expect(toRuleLanguage(undefined)).toBe("en");
    expect(ruleLanguageFromEnv({ AI_REVIEW_COMMENT_LANGUAGE: "en" })).toBe("en");
    expect(ruleLanguageFromEnv({ AI_REVIEW_COMMENT_LANGUAGE: "farsi" })).toBe("fa");
    expect(ruleLanguageFromEnv({})).toBe("fa");
  });

  it("covers every registered rule id in both languages", () => {
    const ids = [...DEFAULT_RULES, ...GOVERNANCE_RULES].map((r) => r.id);
    for (const id of ids) {
      expect(RULE_MESSAGES[id], id).toBeDefined();
      const en = ruleMessage(id, "en", { title: "t", branch: "b" });
      const fa = ruleMessage(id, "fa", { title: "t", branch: "b" });
      expect(en, id).not.toMatch(PERSIAN);
      expect(fa, id).toMatch(PERSIAN);
    }
  });
});
