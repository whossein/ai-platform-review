import { useCallback, useEffect, useMemo, useState } from "react";
import { ScanSearch, Play, Square, RefreshCw, AlertCircle, Download } from "lucide-react";
import {
  fetchProjectScan,
  startProjectScan,
  cancelProjectScan,
  fetchProjectBranches,
  type ProjectBranches,
  type ProjectScanResponse,
  type ScanSeverity,
} from "./api.js";
import { useAppConfig, resolveGitEnv } from "./Settings.js";

interface ProjectScanTabProps {
  projectId: string;
  userRole?: string | undefined;
  repositoryUrl?: string | undefined;
}

const POLL_MS = 2000;
const PAGE = 100;
const SEVERITIES: readonly ScanSeverity[] = ["critical", "high", "medium", "low", "info"];
const SEV_COLOR: Record<ScanSeverity, string> = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#d29922",
  low: "#58a6ff",
  info: "#8b949e",
};

export function ProjectScanTab({ projectId, userRole, repositoryUrl }: ProjectScanTabProps): React.JSX.Element {
  const [config] = useAppConfig();
  const gitEnv = resolveGitEnv(config, repositoryUrl);
  const gitToken = gitEnv.GITLAB_TOKEN || gitEnv.GITHUB_TOKEN || undefined;
  const canManage = userRole === "OWNER" || userRole === "MANAGER";

  const [data, setData] = useState<ProjectScanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ref, setRef] = useState("");
  const [branches, setBranches] = useState<ProjectBranches | null>(null);
  const [sev, setSev] = useState<ScanSeverity | "all">("all");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);

  const load = useCallback(async () => {
    try {
      setData(await fetchProjectScan(projectId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load scan");
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    fetchProjectBranches(projectId, gitToken)
      .then((b) => {
        if (cancelled) return;
        setBranches(b);
        setRef((cur) => cur || b.defaultBranch);
      })
      .catch(() => undefined); // user can still type a branch
    return () => {
      cancelled = true;
    };
  }, [projectId, canManage, gitToken]);

  const job = data?.job;
  const report = data?.report;
  const active = job?.status === "queued" || job?.status === "running";

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [active, load]);

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (report?.findings ?? []).filter(
      (f) =>
        (sev === "all" || f.severity === sev) &&
        (!q || f.file.toLowerCase().includes(q) || f.ruleId.toLowerCase().includes(q) || f.message.toLowerCase().includes(q)),
    );
  }, [report, sev, query]);

  useEffect(() => setShown(PAGE), [sev, query, report]);

  function download(): void {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `scan-${report.job.ref ?? "report"}-${report.job.commitSha?.slice(0, 8) ?? ""}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
        <div>
          <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <ScanSearch size={18} /> Rule Scan <span className="badge">no AI</span>
          </h3>
          <p style={{ margin: "0.25rem 0 0", color: "var(--muted)", fontSize: "0.85rem" }}>
            Scans every text file of a branch with the built-in rules (secrets, SQL injection, unsafe code, …). Free and
            instant: no AI, no tokens. Uses your connected Git token.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end", flexWrap: "wrap" }}>
          {canManage && (
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={{ fontSize: "0.7rem", marginBottom: "0.25rem" }}>Branch</label>
              {branches && branches.branches.length > 0 ? (
                <select value={ref} disabled={active} onChange={(e) => setRef(e.target.value)} style={{ width: "16rem" }}>
                  {!branches.branches.includes(ref) && ref && <option value={ref}>{ref}</option>}
                  {branches.branches.map((b) => (
                    <option key={b} value={b}>
                      {b}
                      {b === branches.defaultBranch ? " (default)" : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={ref}
                  onChange={(e) => setRef(e.target.value)}
                  placeholder="Branch, tag or commit SHA"
                  disabled={active}
                  style={{ width: "16rem" }}
                />
              )}
            </div>
          )}
          <button className="btn btn-secondary" onClick={() => void load()} title="Refresh" style={{ height: "2.4rem" }}>
            <RefreshCw size={14} />
          </button>
          {canManage &&
            (active ? (
              <button className="btn btn-secondary" style={{ height: "2.4rem" }} onClick={() => void run(() => cancelProjectScan(projectId))}>
                <Square size={14} /> Cancel
              </button>
            ) : (
              <button
                className="btn btn-primary"
                style={{ height: "2.4rem" }}
                onClick={() => void run(() => startProjectScan(projectId, ref.trim() || undefined, gitToken))}
              >
                <Play size={14} /> Scan branch
              </button>
            ))}
        </div>
      </div>

      {error && (
        <div className="card" style={{ display: "flex", gap: "0.5rem", alignItems: "center", color: "var(--danger, #ef4444)" }}>
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {job && (
        <div className="card" style={{ fontSize: "0.85rem" }}>
          <strong>Scan {job.status}</strong>
          {job.ref ? ` · ${job.ref}` : ""}
          {job.commitSha ? ` · ${job.commitSha.slice(0, 8)}` : ""}
          {active && job.progress.total > 0 ? ` (${job.progress.done}/${job.progress.total})` : ""}
          {job.progress.message ? ` — ${job.progress.message}` : ""}
          {job.error && (
            <div style={{ color: "var(--danger, #ef4444)", marginTop: "0.25rem" }}>
              {job.error}
              {!gitToken && /404|401|403/.test(job.error) && (
                <div style={{ color: "var(--muted)", marginTop: "0.25rem" }}>
                  No Git token found for this host. Add one in Settings → Git Provider Settings.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {!report && !job && (
        <div className="card" style={{ color: "var(--muted)" }}>
          This project has not been scanned yet.
        </div>
      )}

      {report && (
        <>
          <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: "1.25rem", alignItems: "center" }}>
            <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
              Branch <strong style={{ color: "var(--text)" }}>{report.job.ref}</strong> ·{" "}
              <span style={{ fontFamily: "monospace" }}>{report.job.commitSha?.slice(0, 8)}</span> ·{" "}
              {report.summary.filesScanned} files · {(report.summary.durationMs / 1000).toFixed(1)}s ·{" "}
              {report.job.finishedAt ? new Date(report.job.finishedAt).toLocaleString() : ""}
            </div>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {SEVERITIES.map((s) => (
                <button
                  key={s}
                  className="badge"
                  onClick={() => setSev(sev === s ? "all" : s)}
                  style={{
                    cursor: "pointer",
                    border: `1px solid ${SEV_COLOR[s]}`,
                    color: SEV_COLOR[s],
                    background: sev === s ? "rgba(255,255,255,0.08)" : "transparent",
                  }}
                >
                  {s}: {report.summary.bySeverity[s]}
                </button>
              ))}
            </div>
            <button className="btn btn-secondary" onClick={download} style={{ marginLeft: "auto" }}>
              <Download size={14} /> JSON
            </button>
          </div>

          {report.summary.truncated && (
            <div className="card" style={{ fontSize: "0.85rem", color: "var(--medium, #d29922)" }}>
              Large repository: only part of it was scanned or the findings list was capped. Narrow the scope or fix the top issues and re-scan.
            </div>
          )}

          <div className="card">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by file, rule or message…"
              style={{ width: "100%", marginBottom: "0.75rem" }}
            />
            {filtered.length === 0 ? (
              <p style={{ color: "var(--muted)", margin: 0 }}>
                {report.summary.totalFindings === 0 ? "No issues found. 🎉" : "No findings match the filter."}
              </p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", fontSize: "0.8rem", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                      <th style={{ padding: "0.3rem 0.5rem" }}>Severity</th>
                      <th>Rule</th>
                      <th>Location</th>
                      <th>Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(0, shown).map((f, i) => (
                      <tr key={`${f.file}:${f.line}:${f.ruleId}:${i}`} style={{ borderTop: "1px solid var(--border)", verticalAlign: "top" }}>
                        <td style={{ padding: "0.35rem 0.5rem", color: SEV_COLOR[f.severity], fontWeight: 600 }}>{f.severity}</td>
                        <td style={{ fontFamily: "monospace", whiteSpace: "nowrap" }}>{f.ruleId}</td>
                        <td style={{ fontFamily: "monospace", wordBreak: "break-all" }}>
                          {f.file}:{f.line}
                        </td>
                        <td>
                          {f.message}
                          {f.snippet && (
                            <pre style={{ margin: "0.25rem 0 0", padding: "0.3rem 0.5rem", background: "var(--panel)", borderRadius: 4, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                              {f.snippet}
                            </pre>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {filtered.length > shown && (
              <button className="btn btn-secondary" style={{ marginTop: "0.75rem" }} onClick={() => setShown((n) => n + PAGE)}>
                Show more ({filtered.length - shown} left)
              </button>
            )}
          </div>
        </>
      )}

      {(data?.history.length ?? 0) > 0 && (
        <details className="card">
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Scan history ({data!.history.length})</summary>
          <div style={{ overflowX: "auto", marginTop: "0.5rem" }}>
            <table style={{ width: "100%", fontSize: "0.8rem", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                  <th style={{ padding: "0.3rem 0.5rem" }}>When</th>
                  <th>Status</th>
                  <th>Branch</th>
                  <th>Commit</th>
                  <th>Findings</th>
                  <th>Files</th>
                </tr>
              </thead>
              <tbody>
                {data!.history.map((h) => (
                  <tr key={h.id} style={{ borderTop: "1px solid var(--border)" }} title={h.error}>
                    <td style={{ padding: "0.3rem 0.5rem", whiteSpace: "nowrap" }}>{new Date(h.startedAt).toLocaleString()}</td>
                    <td style={{ color: h.status === "succeeded" ? "#2ed573" : h.status === "failed" ? "var(--danger, #ef4444)" : "var(--muted)" }}>
                      {h.status}
                    </td>
                    <td>{h.ref ?? "—"}</td>
                    <td style={{ fontFamily: "monospace" }}>{h.commitSha?.slice(0, 8) ?? "—"}</td>
                    <td>{h.summary?.totalFindings ?? "—"}</td>
                    <td>{h.summary?.filesScanned ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
