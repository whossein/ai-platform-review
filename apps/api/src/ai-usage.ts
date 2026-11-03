/**
 * "Was this MR written with AI?" estimator.
 *
 * Two independent opinions are combined:
 *  1. deterministic rules over commit messages, MR text and added lines
 *     (explicit AI trailers are strong evidence; style hints are weak), and
 *  2. an optional LLM judge that reads the diff.
 *
 * The result is an estimate for reviewers, never proof, and is kept separate
 * from the review and cost-estimate flows.
 */

export interface AiUsageInput {
  readonly title?: string | undefined;
  readonly description?: string | undefined;
  readonly commitMessages: readonly string[];
  readonly diff: string;
}

export interface RuleSignal {
  readonly label: string;
  readonly weight: number;
  readonly hard: boolean;
}

export interface RuleResult {
  readonly score: number;
  readonly signals: readonly RuleSignal[];
}

const TOOLS = "Claude|Copilot|Cursor|Codex|ChatGPT|GPT-?\\d*|Gemini|Aider|Devin|Windsurf|Cody|Tabnine";
const HARD_PATTERNS: readonly { re: RegExp; label: string }[] = [
  { re: new RegExp(`co-authored-by:[^\\n]*\\b(${TOOLS})\\b`, "i"), label: "Commit has an AI Co-Authored-By trailer" },
  { re: new RegExp(`generated (with|by|using)[^\\n]{0,40}\\b(${TOOLS})\\b`, "i"), label: "Text says it was generated with an AI tool" },
  { re: /🤖\s*generated/i, label: "Text has a '🤖 Generated' marker" },
];

const COMMENT_LINE = /^\s*(\/\/|#|\*|\/\*|--|<!--)/;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const BOILERPLATE = /(\/\/|#)\s*(step \d+[:.]|here'?s|note that|this (function|method|class) (is responsible|handles|will)|helper function to)/i;

export function ruleSignals(input: AiUsageInput): RuleResult {
  const signals: RuleSignal[] = [];
  const text = [input.title ?? "", input.description ?? "", ...input.commitMessages].join("\n");

  for (const { re, label } of HARD_PATTERNS) {
    if (re.test(text)) signals.push({ label, weight: 90, hard: true });
  }

  const added = input.diff
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1))
    .filter((l) => l.trim() !== "");

  if (added.length >= 30) {
    const comments = added.filter((l) => COMMENT_LINE.test(l)).length;
    const ratio = comments / added.length;
    if (ratio > 0.35) {
      signals.push({ label: `Unusually high comment density (${Math.round(ratio * 100)}% of added lines)`, weight: 15, hard: false });
    }
    const docblocks = added.filter((l) => /^\s*\/\*\*/.test(l)).length;
    if (docblocks >= 5 && docblocks / added.length > 0.04) {
      signals.push({ label: `Many doc-comment blocks (${docblocks})`, weight: 10, hard: false });
    }
    const emoji = added.filter((l) => COMMENT_LINE.test(l) && EMOJI.test(l)).length;
    if (emoji >= 2) signals.push({ label: "Emoji inside code comments", weight: 10, hard: false });
    const boiler = added.filter((l) => BOILERPLATE.test(l)).length;
    if (boiler >= 2) signals.push({ label: "Chat-style boilerplate comments (\"Step 1\", \"Note that\"…)", weight: 10, hard: false });
  }
  if (added.length > 800) signals.push({ label: `Very large change (${added.length} added lines)`, weight: 5, hard: false });
  if (/^#{1,3} .+\n[\s\S]*\n[-*] ✅/m.test(input.description ?? "") || (input.description ?? "").match(/[✅🚀✨📝🔧]/g)?.length! >= 3) {
    signals.push({ label: "MR description with emoji-heavy template style", weight: 8, hard: false });
  }

  const hard = signals.filter((s) => s.hard);
  const soft = signals.filter((s) => !s.hard).reduce((a, s) => a + s.weight, 0);
  const score = hard.length ? 95 : Math.min(60, soft);
  return { score, signals };
}

export interface AiJudge {
  (prompt: { system: string; user: string }): Promise<string>;
}

export interface AiUsageResult {
  readonly percent: number;
  readonly level: "low" | "medium" | "high";
  readonly reasons: string[];
  readonly method: "rules+ai" | "rules";
  readonly rulesScore: number;
  readonly aiScore?: number | undefined;
}

const MAX_DIFF_CHARS = 12000;

export function parseJudgeReply(raw: string): { percent: number; reasons: string[] } | undefined {
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first < 0 || last <= first) return undefined;
  try {
    const obj = JSON.parse(raw.slice(first, last + 1));
    const percent = Number(obj.percent);
    if (!Number.isFinite(percent)) return undefined;
    const reasons = Array.isArray(obj.reasons) ? obj.reasons.map(String).slice(0, 4) : [];
    return { percent: Math.max(0, Math.min(100, Math.round(percent))), reasons };
  } catch {
    return undefined;
  }
}

export function levelOf(percent: number): "low" | "medium" | "high" {
  return percent >= 65 ? "high" : percent >= 35 ? "medium" : "low";
}

export async function estimateAiUsage(input: AiUsageInput, judge?: AiJudge): Promise<AiUsageResult> {
  const rules = ruleSignals(input);
  const reasons = rules.signals.map((s) => s.label);
  const hard = rules.signals.some((s) => s.hard);

  let ai: { percent: number; reasons: string[] } | undefined;
  if (judge) {
    try {
      const reply = await judge({
        system: [
          "You estimate how likely a code change was largely written by an AI assistant.",
          "Look at style signals only: uniform over-explaining comments, boilerplate structure, generic naming, unusually polished or repetitive code, mismatch with the commit messages.",
          "Be conservative: humans also write clean, well-commented code. Do not exceed 85 without explicit evidence.",
          'Reply with ONLY JSON: {"percent": number 0-100, "reasons": [up to 3 short strings]}.',
        ].join("\n"),
        user: [
          `MR title: ${input.title ?? ""}`,
          `Commit messages:\n${input.commitMessages.slice(0, 20).join("\n---\n").slice(0, 2000)}`,
          `Diff (truncated):\n${input.diff.slice(0, MAX_DIFF_CHARS)}`,
        ].join("\n\n"),
      });
      ai = parseJudgeReply(reply);
    } catch {
      ai = undefined;
    }
  }

  let percent: number;
  if (hard) percent = Math.max(rules.score, ai?.percent ?? 0);
  else if (ai) percent = Math.round(0.35 * rules.score + 0.65 * ai.percent);
  else percent = rules.score;

  if (ai) reasons.push(...ai.reasons.map((r) => `AI: ${r}`));
  if (reasons.length === 0) reasons.push("No AI signals found.");
  if (!ai) reasons.push(judge ? "AI judge unavailable; rules only." : "No AI provider configured; rules only.");

  return {
    percent,
    level: levelOf(percent),
    reasons,
    method: ai ? "rules+ai" : "rules",
    rulesScore: rules.score,
    aiScore: ai?.percent,
  };
}
