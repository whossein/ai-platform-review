/**
 * Project instruction routing.
 *
 * Project guidelines are free-form markdown. Sending the whole text to every
 * specialist multiplies its token cost by the number of specialists, so the
 * text is split on headings and each specialist only receives the sections
 * that concern it. Sections whose heading matches no known topic are "general"
 * and go to everyone, so nothing is silently dropped.
 *
 * A heading can name its topics explicitly with a tag: `## Auth rules [security]`.
 */

export type InstructionTopic =
  | "security"
  | "performance"
  | "database"
  | "testing"
  | "governance"
  | "style"
  | "architecture"
  | "react-native"
  | "nextjs"
  | "react"
  | "angular"
  | "vue"
  | "typescript"
  | "python"
  | "dotnet"
  | "android"
  | "ios";

export interface InstructionSection {
  readonly heading: string | undefined;
  readonly body: string;
  /** Empty means "general": delivered to every specialist. */
  readonly topics: readonly InstructionTopic[];
}

const TOPIC_PATTERNS: readonly { topic: InstructionTopic; re: RegExp }[] = [
  { topic: "security", re: /secur|owasp|auth|secret|crypto|xss|csrf|injection|امنیت|احراز|رمز/i },
  { topic: "performance", re: /perform|\bperf\b|speed|optimi[sz]|latency|memory leak|عملکرد|کارایی|بهینه/i },
  { topic: "database", re: /database|\bsql\b|quer(y|ies)|\bdb\b|migration|orm|دیتابیس|پایگاه/i },
  { topic: "testing", re: /\btests?\b|testing|coverage|\bspec\b|تست|آزمون/i },
  { topic: "governance", re: /governance|commit|branch|contribut|release|changelog|pull request|\bpr\b|\bmr\b|merge request|کامیت|برنچ|شاخه/i },
  { topic: "style", re: /style|naming|format|lint|convention|readab|comment|نام‌?گذاری|سبک|خوانایی/i },
  { topic: "architecture", re: /architect|layer|structure|design|pattern|module|معماری|لایه/i },
  { topic: "react-native", re: /react[\s-]?native/i },
  { topic: "nextjs", re: /next\.?js/i },
  { topic: "react", re: /\breact\b|\bhooks?\b|jsx/i },
  { topic: "angular", re: /angular|rxjs/i },
  { topic: "vue", re: /\bvue(js)?\b|nuxt|pinia/i },
  { topic: "typescript", re: /typescript|\btsx?\b|typing|تایپ/i },
  { topic: "python", re: /python|django|flask|fastapi|pydantic/i },
  { topic: "dotnet", re: /\.net|dotnet|c#|csharp|asp\.net|entity framework/i },
  { topic: "android", re: /android|kotlin|jetpack/i },
  { topic: "ios", re: /\bios\b|swift|xcode|uikit/i },
];

const FRAMEWORK_TOPICS: readonly InstructionTopic[] = [
  "react-native", "nextjs", "react", "angular", "vue", "typescript", "python", "dotnet", "android", "ios",
];

/** Topics each specialist accepts, besides general sections. */
const AGENT_TOPICS: Readonly<Record<string, readonly InstructionTopic[]>> = {
  "agent.security-reviewer": ["security"],
  "agent.performance-reviewer": ["performance", "database"],
  "agent.contributing-reviewer": ["governance"],
  // The catch-all reviewer also gets framework rules, so a rule is never unreachable.
  "agent.code-reviewer": ["style", "testing", "architecture", "database", ...FRAMEWORK_TOPICS],
  "agent.react-reviewer": ["react"],
  "agent.react-native-reviewer": ["react-native"],
  "agent.nextjs-reviewer": ["nextjs", "react"],
  "agent.angular-reviewer": ["angular"],
  "agent.vue-reviewer": ["vue"],
  "agent.typescript-reviewer": ["typescript"],
  "agent.python-reviewer": ["python"],
  "agent.dotnet-reviewer": ["dotnet"],
  "agent.android-reviewer": ["android"],
  "agent.ios-reviewer": ["ios"],
};

const KNOWN_TOPICS = new Set<string>(TOPIC_PATTERNS.map((p) => p.topic));
const HEADING = /^#{1,4}\s+(.+?)\s*$/;
const LEARNED_HEADING = /^learned from reviewer feedback:?\s*$/i;

export function topicsOf(heading: string): InstructionTopic[] {
  const tag = /\[([a-z\-, ]+)\]/i.exec(heading)?.[1];
  if (tag) {
    const explicit = tag
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter((t): t is InstructionTopic => KNOWN_TOPICS.has(t));
    if (explicit.length > 0) return explicit;
  }
  const found = TOPIC_PATTERNS.filter((p) => p.re.test(heading)).map((p) => p.topic);
  // "React Native" must not also count as plain "React".
  return found.includes("react-native") ? found.filter((t) => t !== "react") : found;
}

export function splitInstructionSections(text: string): InstructionSection[] {
  const sections: InstructionSection[] = [];
  let heading: string | undefined;
  let lines: string[] = [];
  let inFence = false;

  const flush = () => {
    const body = lines.join("\n").trim();
    if (heading !== undefined || body) {
      sections.push({
        heading,
        body,
        topics: heading !== undefined && !LEARNED_HEADING.test(heading) ? topicsOf(heading) : [],
      });
    }
  };

  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const m = inFence ? null : HEADING.exec(line);
    if (m || (!inFence && LEARNED_HEADING.test(line.trim()))) {
      flush();
      heading = line.trim();
      lines = [];
    } else {
      lines.push(line);
    }
  }
  flush();
  return sections;
}

/** The part of the project instructions relevant to one specialist. */
export function instructionsForAgent(text: string | undefined, agentId: string): string {
  const trimmed = text?.trim();
  if (!trimmed) return "";
  const accepted = AGENT_TOPICS[agentId];
  // Unknown (plugin) specialists get everything rather than risk missing rules.
  if (!accepted) return trimmed;

  return splitInstructionSections(trimmed)
    .filter((s) => s.topics.length === 0 || s.topics.some((t) => accepted.includes(t)))
    .map((s) => (s.heading !== undefined ? `${s.heading}\n${s.body}` : s.body).trim())
    .filter(Boolean)
    .join("\n\n");
}

/** Rough token count (~4 chars per token); good enough for budgeting and warnings. */
export function estimateTextTokens(text: string | undefined): number {
  return text ? Math.ceil(text.length / 4) : 0;
}
