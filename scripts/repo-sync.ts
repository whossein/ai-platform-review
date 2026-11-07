/**
 * Keeps the public GitHub repo page (description, homepage, topics) in line with the code.
 * Counts are read from the real specialist and rule lists, so they cannot drift.
 *
 *   tsx scripts/repo-sync.ts            print what would be set
 *   tsx scripts/repo-sync.ts --check    fail if README / docs show a different specialist count
 *   tsx scripts/repo-sync.ts --apply    run `gh repo edit` (needs gh + admin token; used by CI)
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { SPECIALISTS } from "../packages/shared/src/agents.ts";
import { DEFAULT_RULES, GOVERNANCE_RULES } from "../packages/config/src/rules.ts";

const REPO = process.env.REPO_SYNC_TARGET ?? "whossein/ai-platform-review";
const HOMEPAGE = "https://whossein.github.io/ai-platform-review/";
const TOPICS = "code-review,ai,llm,multi-agent,gitlab,github,typescript,electron,self-hosted,developer-tools";

const specialists = SPECIALISTS.length;
const rules = DEFAULT_RULES.length + GOVERNANCE_RULES.length;
const description =
  `Self-hosted multi-agent AI code review for GitLab MRs, GitHub PRs and diffs. ` +
  `${specialists} specialist reviewers, ${rules} free rules, any LLM provider, hard cost budgets.`;

const toFa = (n: number) => String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

function check(): string[] {
  const problems: string[] = [];
  const expect = (file: string, re: RegExp, want: string) => {
    const got = re.exec(read(file))?.[1];
    if (got !== want) problems.push(`${file}: shows "${got ?? "nothing"}", code has ${want}`);
  };
  expect("README.md", /(\d+) Specialized Review Personas/, String(specialists));
  expect("README.md", /([۰-۹]+) ارزیاب متخصص/, toFa(specialists));
  expect("docs/index.html", /(\d+) Specialists\. One Review/, String(specialists));
  return problems;
}

const arg = process.argv[2];
if (arg === "--check") {
  const problems = check();
  if (problems.length) {
    console.error("Repo sync check failed:\n- " + problems.join("\n- "));
    process.exit(1);
  }
  console.log(`Counts OK (${specialists} specialists, ${rules} rules)`);
} else if (arg === "--apply") {
  const r = spawnSync(
    "gh",
    ["repo", "edit", REPO, "--description", description, "--homepage", HOMEPAGE, "--add-topic", TOPICS],
    { stdio: "inherit" },
  );
  process.exit(r.status ?? 1);
} else {
  console.log(JSON.stringify({ repo: REPO, description, homepage: HOMEPAGE, topics: TOPICS }, null, 2));
}
