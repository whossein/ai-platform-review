import { useCallback, useEffect, useState } from "react";
import { Network, Play, Square, RefreshCw, AlertCircle } from "lucide-react";
import {
  fetchProjectIndex,
  startProjectIndex,
  cancelProjectIndex,
  type ProjectIndexResponse,
} from "./api.js";

interface ProjectIndexTabProps {
  projectId: string;
  userRole?: string | undefined;
}

const POLL_MS = 2000;

export function ProjectIndexTab({ projectId, userRole }: ProjectIndexTabProps): JSX.Element {
  const [data, setData] = useState<ProjectIndexResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ref, setRef] = useState("");
  const canManage = userRole === "OWNER" || userRole === "MANAGER";

  const load = useCallback(async () => {
    try {
      setData(await fetchProjectIndex(projectId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load index");
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

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
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <button className="btn btn-secondary" onClick={() => void load()} title="Refresh">
            <RefreshCw size={14} />
          </button>
          {canManage && (
            <>
              <input
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                placeholder="Branch / tag / SHA (optional)"
                disabled={active}
                style={{ width: "14rem" }}
              />
              {active ? (
                <button className="btn btn-secondary" onClick={() => void run(() => cancelProjectIndex(projectId))}>
                  <Square size={14} /> Cancel
                </button>
              ) : (
                <button className="btn btn-primary" onClick={() => void run(() => startProjectIndex(projectId, ref.trim() || undefined))}>
                  <Play size={14} /> {index ? "Re-index" : "Index project"}
                </button>
              )}
            </>
          )}
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
          {job.error && <div style={{ color: "var(--danger, #ef4444)", marginTop: "0.25rem" }}>{job.error}</div>}
        </div>
      )}

      {!index && !job && (
        <div className="card" style={{ color: "var(--muted)" }}>
          This project has not been indexed yet.
        </div>
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
