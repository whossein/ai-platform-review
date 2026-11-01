// Fails when the current version has no CHANGELOG entry or the docs page shows a different version.
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");

const { version } = JSON.parse(read("package.json"));
const problems = [];

const changelog = read("CHANGELOG.md");
const entry = new RegExp(`^## \\[${version.replace(/\./g, "\\.")}\\] - \\d{4}-\\d{2}-\\d{2}$`, "m");
if (!entry.test(changelog)) {
  problems.push(`CHANGELOG.md has no "## [${version}] - YYYY-MM-DD" entry`);
} else {
  const body = changelog.split(entry)[1]?.split(/^## /m)[0] ?? "";
  if (!/\*\*EN:\*\*/.test(body) || !/\*\*FA:\*\*/.test(body)) {
    problems.push(`CHANGELOG.md entry ${version} must contain both **EN:** and **FA:** lines`);
  }
}

const docs = read("docs/index.html");
const shown = /<span id="app-version">([^<]+)<\/span>/.exec(docs)?.[1];
if (shown !== version) problems.push(`docs/index.html shows version ${shown}, package.json is ${version}`);
if (!docs.includes(`id="release-notes"`)) problems.push(`docs/index.html is missing the #release-notes section`);

if (problems.length) {
  console.error("Changelog check failed:\n- " + problems.join("\n- "));
  process.exit(1);
}
console.log(`Changelog OK for v${version}`);
