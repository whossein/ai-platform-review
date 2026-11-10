// Self-hosted star-history + downloads charts, published by .github/workflows/repo-charts.yml to the orphan `badges` branch.
// Usage: GITHUB_TOKEN=... REPO=owner/name node scripts/repo-charts.mjs <out-dir>
//        node scripts/repo-charts.mjs --selftest
// GitHub has no download history endpoint, so downloads-history.json gains a point whenever the total changes;
// unchanged totals add nothing, so unchanged days push nothing.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";

const INSTALLER = /\.(exe|dmg|zip|AppImage|deb|rpm)$/i;

export function lineChart(title, points, color) {
  const W = 800, H = 300, L = 60, R = 20, T = 40, B = 40;
  const ts = points.map((p) => p.t), vs = points.map((p) => p.v);
  const t0 = Math.min(...ts), t1 = Math.max(...ts), vMax = Math.max(1, ...vs);
  const x = (t) => L + (t1 === t0 ? 0 : ((t - t0) / (t1 - t0)) * (W - L - R));
  const y = (v) => H - B - (v / vMax) * (H - T - B);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const day = (t) => new Date(t).toISOString().slice(0, 10);
  // Mid-grey text + transparent background reads on both GitHub light and dark themes.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="system-ui,sans-serif" font-size="12" fill="#8b949e">
<text x="${L}" y="24" font-size="16" font-weight="600">${title}</text>
<line x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}" stroke="#8b949e" stroke-opacity=".4"/>
<line x1="${L}" y1="${T}" x2="${L}" y2="${H - B}" stroke="#8b949e" stroke-opacity=".4"/>
<text x="${L - 8}" y="${T + 4}" text-anchor="end">${vMax}</text>
<text x="${L - 8}" y="${H - B + 4}" text-anchor="end">0</text>
${points.length ? `<text x="${L}" y="${H - 16}">${day(t0)}</text><text x="${W - R}" y="${H - 16}" text-anchor="end">${day(t1)}</text>` : `<text x="${W / 2}" y="${H / 2}" text-anchor="middle">no data yet</text>`}
<path d="${path}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round"/>
</svg>
`;
}

export const cumulative = (dates) =>
  dates.map((d) => Date.parse(d)).sort((a, b) => a - b).map((t, i) => ({ t, v: i + 1 }));

export function appendToday(history, count, today = new Date().toISOString().slice(0, 10)) {
  if (history.at(-1)?.count === count) return history;
  return [...history.filter((p) => p.date !== today), { date: today, count }];
}

async function gh(path, accept = "application/vnd.github+json") {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept },
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function all(path, accept) {
  const out = [];
  for (let page = 1; ; page++) {
    const batch = await gh(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`, accept);
    out.push(...batch);
    if (batch.length < 100) return out;
  }
}

async function main([outDir]) {
  const repo = process.env.REPO;
  mkdirSync(outDir, { recursive: true });

  const stars = await all(`/repos/${repo}/stargazers`, "application/vnd.github.star+json");
  writeFileSync(`${outDir}/stars.svg`, lineChart(`★ ${stars.length} stars`, cumulative(stars.map((s) => s.starred_at)), "#e3b341"));

  const releases = await all(`/repos/${repo}/releases`);
  const total = releases.flatMap((r) => r.assets).filter((a) => INSTALLER.test(a.name)).reduce((n, a) => n + a.download_count, 0);
  let prev = [];
  try { prev = JSON.parse(readFileSync(`${outDir}/downloads-history.json`, "utf8")); } catch { /* first run */ }
  const history = appendToday(prev, total);
  writeFileSync(`${outDir}/downloads-history.json`, JSON.stringify(history, null, 1) + "\n");
  writeFileSync(`${outDir}/downloads.json`, JSON.stringify({ schemaVersion: 1, label: "downloads", message: String(total), color: "blue" }) + "\n");
  writeFileSync(`${outDir}/downloads.svg`, lineChart(`⬇ ${total} installer downloads`, history.map((p) => ({ t: Date.parse(p.date), v: p.count })), "#58a6ff"));
  console.log(`**Stars:** ${stars.length} · **Installer downloads:** ${total} · history points: ${history.length}`);
}

function selftest() {
  const pts = cumulative(["2026-03-01T00:00:00Z", "2026-01-01T00:00:00Z"]);
  assert.deepEqual(pts.map((p) => p.v), [1, 2]);
  assert.ok(pts[0].t < pts[1].t);
  assert.deepEqual(appendToday([{ date: "2026-01-01", count: 1 }, { date: "2026-01-02", count: 2 }], 5, "2026-01-02"),
    [{ date: "2026-01-01", count: 1 }, { date: "2026-01-02", count: 5 }]);
  const same = [{ date: "2026-01-01", count: 3 }];
  assert.equal(appendToday(same, 3, "2026-01-09"), same);
  assert.match(lineChart("t", pts, "red"), /<path d="M60\.0,150\.0L780\.0,40\.0"/);
  assert.match(lineChart("t", [], "red"), /no data yet/);
  console.log("selftest ok");
}

if (process.argv[2] === "--selftest") selftest();
else await main(process.argv.slice(2));
