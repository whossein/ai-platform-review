/**
 * Rewrites project guidelines with an LLM into (1) a cleaner, sectioned text
 * for people and (2) a terser version that is sent to reviewers to save tokens.
 * Both keep `## Topic` headings so each specialist can still be sent only the
 * sections that concern it.
 */

import { estimateTextTokens, splitInstructionSections, topicsOf, type InstructionTopic } from "@ai-review/shared";

export type InstructionsLlm = (prompt: { system: string; user: string }) => Promise<string>;

export interface OptimizedInstructions {
  readonly improved: string;
  readonly compact: string;
  readonly tokens: { readonly original: number; readonly improved: number; readonly compact: number };
}

const SYSTEM = `You rewrite project guidelines used by an AI code-review system.
Return ONLY JSON, no markdown fences: {"improved": string, "compact": string}.

Rules for both fields:
- Keep EVERY distinct requirement, exact identifiers, numbers and file names. Never invent rules.
- LANGUAGE_RULE
- Merge duplicates and contradictions-free paraphrases; drop filler, greetings and explanations of why.
- Use markdown "## Heading" sections with short imperative bullets. Prefer these headings when they fit: General, Security, Performance, Database, Testing, Style & Naming, Architecture, Git & Commits, or a framework/language name (React, TypeScript, Python, ...). Put rules that apply everywhere under "## General".

"improved": clear and readable for the team.
"compact": the same sections and requirements, written telegraphically (no examples, minimal words), about 40% of the length of "improved" or less.`;

const KEEP_LANGUAGE = "Keep the original language of each rule.";
const TO_ENGLISH =
  "Write everything in clear English (translate other languages; models follow English better and it costs fewer tokens). Keep code identifiers, paths and quoted UI strings exactly as written, and keep a rule that is itself about output language (e.g. 'UI texts must be Persian') meaning-preserving.";

/**
 * Rules created from reviewer feedback look like
 * `- Do not report "<finding title>" (<category>) in this project: <why>`.
 * They are machine-written and exact (the title is matched against future
 * findings), so they are kept verbatim and filed under the topic of their
 * category instead of being paraphrased into "General".
 */
const LEARNED_RULE = /^\s*-\s*Do not report\s+"[^"]*"\s*\(([^)]*)\)/i;
const LEARNED_HEADING = /^\s*learned from reviewer feedback:?\s*$/i;

const TOPIC_HEADINGS: Partial<Record<InstructionTopic, string>> = {
  security: "Security",
  performance: "Performance",
  database: "Database",
  testing: "Testing",
  governance: "Git & Commits",
  style: "Style & Naming",
  architecture: "Architecture",
  "react-native": "React Native",
  nextjs: "Next.js",
  react: "React",
  angular: "Angular",
  vue: "Vue",
  typescript: "TypeScript",
  python: "Python",
  dotnet: ".NET",
  android: "Android",
  ios: "iOS",
};

export function headingForCategory(category: string): string {
  const topic = topicsOf(category)[0];
  return (topic && TOPIC_HEADINGS[topic]) || "General";
}

/**
 * Shorter form for the prompt: drops the boilerplate that every learned rule
 * repeats ("in this project", "this is an intentional project convention")
 * and keeps the verb, the quoted title, the category and the reason.
 */
export function compactLearnedRule(line: string): string {
  return line
    .replace(/\)\s+in this project\b/i, ")")
    .replace(/([:—–-])\s*this is an intentional project convention\s*[—–:-]?\s*/i, "$1 ")
    .replace(/\s*[—–-]\s*$/, "")
    .replace(/:\s*$/, "")
    .replace(/\.\s*$/, "")
    .trim();
}

/** Removes headings that have no body left (e.g. after learned rules were pulled out of them). */
export function dropEmptySections(markdown: string): string {
  return splitInstructionSections(markdown)
    .filter((sec) => sec.body.trim() !== "")
    .map((sec) => (sec.heading !== undefined ? `${sec.heading}\n${sec.body}` : sec.body))
    .join("\n\n")
    .trim();
}

/** Drops learned rules the AI wrote into its own output; the originals are merged back separately. */
function withoutLearnedRules(markdown: string): string {
  return dropEmptySections(
    markdown
      .split("\n")
      .filter((l) => !LEARNED_RULE.test(l))
      .join("\n"),
  );
}

export function extractLearnedRules(text: string): { rest: string; rules: { line: string; heading: string }[] } {
  const rules: { line: string; heading: string }[] = [];
  const rest: string[] = [];
  for (const line of text.split("\n")) {
    const m = LEARNED_RULE.exec(line);
    if (m) rules.push({ line: line.trim(), heading: headingForCategory(m[1]!) });
    else if (!LEARNED_HEADING.test(line)) rest.push(line);
  }
  return { rest: dropEmptySections(rest.join("\n")), rules };
}

/** Adds each rule to the end of its `## Heading` section, creating the section when missing. */
export function mergeLearnedRules(markdown: string, rules: readonly { line: string; heading: string }[]): string {
  let out = markdown.trim();
  const byHeading = new Map<string, string[]>();
  for (const r of rules) byHeading.set(r.heading, [...(byHeading.get(r.heading) ?? []), r.line]);

  for (const [heading, lines] of byHeading) {
    const lineList = out.split("\n");
    const start = lineList.findIndex((l) => new RegExp(`^#{1,4}\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i").test(l.trim()));
    if (start === -1) {
      out = `${out}${out ? "\n\n" : ""}## ${heading}\n${lines.join("\n")}`;
      continue;
    }
    let end = lineList.length;
    for (let i = start + 1; i < lineList.length; i++) {
      if (/^#{1,4}\s+/.test(lineList[i]!)) {
        end = i;
        break;
      }
    }
    const section = lineList.slice(start, end);
    while (section.length > 1 && section[section.length - 1]!.trim() === "") section.pop();
    lineList.splice(start, end - start, ...section, ...lines, ...(end < lineList.length ? [""] : []));
    out = lineList.join("\n");
  }
  return out.trim();
}

const RULES_SYSTEM = `
Also translate the numbered "LEARNED RULES" to English and return them as "rules": string[] (same order, same count, one string per rule, each still starting with "- Do not report"). Keep the structure: - Do not report "<title>" (<category>) in this project: <reason>. Translate the title and reason, but keep the (<category>) and any dotted rule ids (like governance.require-release-change) exactly as they are. Do not merge, drop or add rules.`;

export function buildOptimizePrompt(
  text: string,
  opts: { english?: boolean; rules?: readonly string[] } = {},
): { system: string; user: string } {
  const withRules = opts.english && opts.rules && opts.rules.length > 0;
  const body = text.trim()
    ? `Project guidelines to rewrite:\n\n${text.trim()}`
    : "Project guidelines to rewrite: (none, only learned rules)";
  return {
    system: SYSTEM.replace("LANGUAGE_RULE", opts.english ? TO_ENGLISH : KEEP_LANGUAGE) + (withRules ? RULES_SYSTEM : ""),
    user: withRules
      ? `${body}\n\nLEARNED RULES:\n${opts.rules!.map((r, i) => `${i + 1}. ${r.replace(/^\s*-\s*/, "")}`).join("\n")}`
      : body,
  };
}

function parseJson(raw: string): { improved?: unknown; compact?: unknown; rules?: unknown } | undefined {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  try {
    return JSON.parse(fenced ? fenced[1]! : trimmed);
  } catch {
    return undefined;
  }
}

export async function optimizeInstructions(
  text: string,
  llm: InstructionsLlm,
  opts: { english?: boolean } = {},
): Promise<OptimizedInstructions> {
  const source = text.trim();
  if (!source) throw new Error("There are no guidelines to optimize.");

  const { rest, rules } = extractLearnedRules(source);
  let improved = "";
  let compact = "";
  let finalRules = rules;
  const translateRules = opts.english === true && rules.length > 0;
  if (rest || translateRules) {
    const parsed = parseJson(await llm(buildOptimizePrompt(rest, { ...opts, rules: rules.map((r) => r.line) })));
    if (rest) {
      improved = typeof parsed?.improved === "string" ? parsed.improved.trim() : "";
      compact = typeof parsed?.compact === "string" ? parsed.compact.trim() : "";
      if (!improved) throw new Error("The AI did not return usable guidelines. Try again.");
      if (!compact || compact.length > improved.length) compact = improved;
    }
    // Use the translations only if every rule came back intact; otherwise keep the originals.
    const translated = Array.isArray(parsed?.rules) ? parsed.rules : [];
    if (
      translateRules &&
      translated.length === rules.length &&
      translated.every((t) => typeof t === "string" && /do not report/i.test(t))
    ) {
      finalRules = rules.map((r, i) => {
        const t = (translated[i] as string).trim();
        return { heading: r.heading, line: t.startsWith("-") ? t : `- ${t}` };
      });
    }
  }
  improved = mergeLearnedRules(withoutLearnedRules(improved), finalRules);
  compact = mergeLearnedRules(
    withoutLearnedRules(compact),
    finalRules.map((r) => ({ heading: r.heading, line: compactLearnedRule(r.line) })),
  );

  return {
    improved,
    compact,
    tokens: {
      original: estimateTextTokens(source),
      improved: estimateTextTokens(improved),
      compact: estimateTextTokens(compact),
    },
  };
}
