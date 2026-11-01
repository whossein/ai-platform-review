import { useCallback, useEffect, useState } from "react";
import { Network, Play, Square, RefreshCw, AlertCircle } from "lucide-react";
import {
  fetchProjectIndex,
  startProjectIndex,
  cancelProjectIndex,
  fetchProjectBranches,
  fetchProjectIndexHistory,
  type ProjectIndexHistoryEntry,
  type ProjectBranches,
  type ProjectIndexResponse,
} from "./api.js";
import { useAppConfig, resolveGitEnv } from "./Settings.js";

interface ProjectIndexTabProps {
  projectId: string;
  userRole?: string | undefined;
  /** Repository URL, used to pick the matching Git connection from Settings. */
  repositoryUrl?: string | undefined;
}

const POLL_MS = 2000;
const CUSTOM_REF = "__custom__";

export function ProjectIndexTab({ projectId, userRole, repositoryUrl }: ProjectIndexTabProps): JSX.Element {
  const [config] = useAppConfig();
  const gitEnv = resolveGitEnv(config, repositoryUrl);
  const gitToken = gitEnv.GITLAB_TOKEN || gitEnv.GITHUB_TOKEN || undefined;
  const [data, setData] = useState<ProjectIndexResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ref, setRef] = useState("");
  const [branches, setBranches] = useState<ProjectBranches | null>(null);
  const [history, setHistory] = useState<ProjectIndexHistoryEntry[]>([]);
  const [customRef, setCustomRef] = useState(false);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchesError, setBranchesError] = useState<string | null>(null);
  const canManage = userRole === "OWNER" || userRole === "MANAGER";

  const load = useCallback(async () => {
    try {
      const [idx, hist] = await Promise.all([
        fetchProjectIndex(projectId),
        fetchProjectIndexHistory(projectId).catch(() => null),
      ]);
      setData(idx);
      if (hist) setHistory(hist);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load index");
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Load branches from the git host and prefill the default branch
  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    setBranchesLoading(true);
    setBranchesError(null);
    fetchProjectBranches(projectId, gitToken)
      .then((b) => {
        if (cancelled) return;
        setBranches(b);
        setRef((current) => current || b.defaultBranch);
      })
      .catch((e) => {
        if (!cancelled) {
          setBranchesError(e instanceof Error ? e.message : "Failed to load branches");
        }
      })
      .finally(() => {
        if (!cancelled) setBranchesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, canManage, gitToken]);

  const active = data?.job?.status === "queued" || data?.job?.status === "running";
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

  const job = data?.job;
  const index = data?.index;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
        <div>
          <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Network size={18} /> Structural Index
          </h3>
          <p style={{ margin: "0.25rem 0 0", color: "var(--muted)", fontSize: "0.85rem" }}>
            Symbols, imports and the dependency graph of this repository. Uses your connected Git token.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end", flexWrap: "wrap" }}>
          {canManage && (
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={{ fontSize: "0.7rem", marginBottom: "0.25rem" }}>
                Branch{branches ? ` (default: ${branches.defaultBranch})` : ""}
              </label>
              <div style={{ display: "flex", gap: "0.35rem" }}>
                {branches && branches.branches.length > 0 && !customRef ? (
                  <select
                    value={ref}
                    disabled={active}
                    onChange={(e) => {
                      if (e.target.value === CUSTOM_REF) {
                        setCustomRef(true);
                        setRef("");
                      } else {
                        setRef(e.target.value);
                      }
                    }}
                    style={{ width: "16rem" }}
                  >
                    {!branches.branches.includes(ref) && ref && <option value={ref}>{ref}</option>}
                    {branches.branches.map((b) => (
                      <option key={b} value={b}>
                        {b}
                        {b === branches.defaultBranch ? " (default)" : ""}
                      </option>
                    ))}
                    <option value={CUSTOM_REF}>Other (tag / commit SHA)…</option>
                  </select>
                ) : (
                  <>
                    <input
                      value={ref}
                      onChange={(e) => setRef(e.target.value)}
                      placeholder={branchesLoading ? "Loading branches..." : "Branch, tag or commit SHA"}
                      disabled={active}
                      style={{ width: "16rem" }}
                    />
                    {branches && branches.branches.length > 0 && (
                      <button
                        className="btn btn-secondary"
                        disabled={active}
                        onClick={() => {
                          setCustomRef(false);
                          setRef(branches.defaultBranch);
                        }}
                        title="Pick from the branch list"
                      >
                        List
                      </button>
                    )}
                  </>
                )}
              </div>
              {branchesError && (
                <span style={{ fontSize: "0.7rem", color: "var(--muted)" }} title={branchesError}>
                  Could not load branches from the git host; you can still type one.
                </span>
              )}
            </div>
          )}
          <button className="btn btn-secondary" onClick={() => void load()} title="Refresh" style={{ height: "2.4rem" }}>
            <RefreshCw size={14} />
          </button>
          {canManage &&
            (active ? (
              <button className="btn btn-secondary" style={{ height: "2.4rem" }} onClick={() => void run(() => cancelProjectIndex(projectId))}>
                <Square size={14} /> Cancel
              </button>
            ) : (
              <button
                className="btn btn-primary"
                style={{ height: "2.4rem" }}
                onClick={() => void run(() => startProjectIndex(projectId, ref.trim() || undefined, gitToken))}
              >
                <Play size={14} /> {index ? "Re-index" : "Index project"}
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
          <strong>Job {job.status}</strong>
          {job.ref ? ` · ${job.ref}` : ""} · {job.progress.phase}
          {job.progress.total > 0 && active ? ` (${job.progress.done}/${job.progress.total})` : ""}
          {job.progress.message ? ` — ${job.progress.message}` : ""}
          {job.error && (
            <div style={{ color: "var(--danger, #ef4444)", marginTop: "0.25rem" }}>
              {job.error}
              {!gitToken && /404|401|403/.test(job.error) && (
                <div style={{ color: "var(--muted)", marginTop: "0.25rem" }}>
                  No Git token found for this host. Add one in Settings → Git Provider Settings (or Profile &amp; Git).
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {!index && !job && (
        <div className="card" style={{ color: "var(--muted)" }}>
          This project has not been indexed yet.
        </div>
      )}

      {history.length > 0 && (
        <details className="card">
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>
            Index history ({history.length})
          </summary>
          <div style={{ overflowX: "auto", marginTop: "0.5rem" }}>
            <table style={{ width: "100%", fontSize: "0.8rem", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                  <th style={{ padding: "0.3rem 0.5rem" }}>When</th>
                  <th>Status</th>
                  <th>Branch</th>
                  <th>Commit</th>
                  <th>Files</th>
                  <th>Symbols</th>
                  <th>Reused</th>
                  <th>Duration</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} style={{ borderTop: "1px solid var(--border)" }} title={h.error}>
                    <td style={{ padding: "0.3rem 0.5rem", whiteSpace: "nowrap" }}>
                      {new Date(h.startedAt).toLocaleString()}
                    </td>
                    <td
                      style={{
                        color:
                          h.status === "succeeded"
                            ? "#2ed573"
                            : h.status === "failed"
                              ? "var(--danger, #ef4444)"
                              : "var(--muted)",
                      }}
                    >
                      {h.status}
                    </td>
                    <td>{h.ref ?? "—"}</td>
                    <td style={{ fontFamily: "monospace" }}>{h.commitSha?.slice(0, 8) ?? "—"}</td>
                    <td>{h.stats?.indexedFilesCount ?? "—"}</td>
                    <td>{h.stats?.totalSymbols ?? "—"}</td>
                    <td>{h.stats?.reusedFilesCount ?? "—"}</td>
                    <td>
                      {h.stats
                        ? `${(h.stats.durationMs / 1000).toFixed(1)}s`
                        : h.error
                          ? <span style={{ color: "var(--danger, #ef4444)" }}>{h.error.slice(0, 60)}</span>
                          : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {index && (
        <>
          <div className="card" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "1rem" }}>
            <Stat label="Files" value={index.stats.indexedFilesCount} />
            <Stat label="Symbols" value={index.stats.totalSymbols} />
            <Stat label="Reused" value={index.stats.reusedFilesCount} />
            <Stat label="Skipped" value={index.stats.skippedFilesCount} />
            <Stat label="Commit" value={index.commitSha.slice(0, 8)} />
            <Stat label="Duration" value={`${(index.stats.durationMs / 1000).toFixed(1)}s`} />
          </div>

          <div className="card">
            <strong>Languages</strong>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.5rem" }}>
              {Object.entries(index.stats.countsByLanguage)
                .sort((a, b) => b[1] - a[1])
                .map(([lang, n]) => (
                  <span key={lang} className="badge">{lang}: {n}</span>
                ))}
            </div>
          </div>

          <div className="card">
            <strong>Most imported files</strong>
            {index.topImportedFiles.length === 0 ? (
              <p style={{ color: "var(--muted)" }}>No internal imports resolved.</p>
            ) : (
              <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.2rem", fontFamily: "monospace", fontSize: "0.8rem" }}>
                {index.topImportedFiles.map((f) => (
                  <li key={f.file}>{f.file} <span style={{ color: "var(--muted)" }}>· {f.importedByCount} importers</span></li>
                ))}
              </ul>
            )}
          </div>

          {index.workspaces.length > 0 && (
            <div className="card">
              <strong>Workspace packages ({index.workspaces.length})</strong>
              <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.2rem", fontFamily: "monospace", fontSize: "0.8rem" }}>
                {index.workspaces.map((w) => (
                  <li key={w.rootPath}>{w.name} <span style={{ color: "var(--muted)" }}>· {w.rootPath}</span></li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }): JSX.Element {
  return (
    <div>
      <div style={{ color: "var(--muted)", fontSize: "0.75rem" }}>{label}</div>
      <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>{value}</div>
    </div>
  );
}
