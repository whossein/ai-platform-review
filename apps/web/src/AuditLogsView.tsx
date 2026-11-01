import { useState, useEffect } from "react";
import {
  History,
  Shield,
  Search,
  RefreshCw,
  Filter,
  User,
  FolderGit2,
  Lock,
  GitBranch,
  Play,
} from "lucide-react";
import type { AuditLogEntry, AuditAction } from "@ai-review/core";
import { fetchAuditLogs } from "./api.js";

export function AuditLogsView(): JSX.Element {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState<string>("");
  const [search, setSearch] = useState("");

  const loadLogs = async () => {
    try {
      setLoading(true);
      const res = await fetchAuditLogs({
        action: actionFilter ? (actionFilter as AuditAction) : undefined,
        limit: 100,
      });
      setLogs(res.logs);
      setTotal(res.total);
    } catch (err: any) {
      console.warn("Error fetching audit logs:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, [actionFilter]);

  const getActionBadge = (action: AuditAction) => {
    let color = "#3b82f6";
    let bg = "rgba(59, 130, 246, 0.15)";
    let border = "rgba(59, 130, 246, 0.3)";
    let icon = <Shield size={12} />;

    if (action.includes("LOGIN") || action.includes("AUTH")) {
      if (action === "FAILED_LOGIN") {
        color = "#ef4444";
        bg = "rgba(239, 68, 68, 0.15)";
        border = "rgba(239, 68, 68, 0.3)";
      } else {
        color = "#10b981";
        bg = "rgba(16, 185, 129, 0.15)";
        border = "rgba(16, 185, 129, 0.3)";
      }
      icon = <Lock size={12} />;
    } else if (action.includes("USER")) {
      color = "#8b5cf6";
      bg = "rgba(139, 92, 246, 0.15)";
      border = "rgba(139, 92, 246, 0.3)";
      icon = <User size={12} />;
    } else if (action.includes("PROJECT")) {
      color = "#f59e0b";
      bg = "rgba(245, 158, 11, 0.15)";
      border = "rgba(245, 158, 11, 0.3)";
      icon = <FolderGit2 size={12} />;
    } else if (action.includes("CREDENTIAL")) {
      color = "#06b6d4";
      bg = "rgba(6, 182, 212, 0.15)";
      border = "rgba(6, 182, 212, 0.3)";
      icon = <GitBranch size={12} />;
    } else if (action.includes("REVIEW")) {
      color = "#ec4899";
      bg = "rgba(236, 72, 153, 0.15)";
      border = "rgba(236, 72, 153, 0.3)";
      icon = <Play size={12} />;
    }

    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.3rem",
          padding: "0.2rem 0.55rem",
          borderRadius: "999px",
          fontSize: "0.75rem",
          fontWeight: 600,
          background: bg,
          color,
          border: `1px solid ${border}`,
        }}
      >
        {icon}
        <span>{action}</span>
      </span>
    );
  };

  const filteredLogs = logs.filter((l) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      l.action.toLowerCase().includes(q) ||
      (l.actorName && l.actorName.toLowerCase().includes(q)) ||
      (l.actorEmail && l.actorEmail.toLowerCase().includes(q)) ||
      l.entityType.toLowerCase().includes(q) ||
      l.entityId.toLowerCase().includes(q)
    );
  });

  return (
    <div className="audit-logs-container">
      {/* Header */}
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "1.5rem", fontWeight: 700 }}>
            <History size={24} className="text-purple-400" />
            <span>Security & Activity Audit Log</span>
          </h1>
          <p style={{ color: "var(--muted)", fontSize: "0.875rem", marginTop: "0.25rem" }}>
            Comprehensive immutable audit trail of authentication, permissions, user roles, project changes, and reviews.
          </p>
        </div>

        <button className="btn btn-secondary" onClick={loadLogs}>
          <RefreshCw size={16} className={loading ? "spin" : ""} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: "1rem", marginBottom: "1.25rem" }}>
        <div className="input-with-icon" style={{ flex: 1, maxWidth: "350px" }}>
          <Search size={16} />
          <input
            type="text"
            placeholder="Search by actor, entity ID, or action..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Filter size={16} className="text-muted" />
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            style={{
              background: "var(--input-bg)",
              border: "1px solid var(--border)",
              color: "var(--text)",
              padding: "0.55rem 0.8rem",
              borderRadius: "6px",
              fontSize: "0.85rem",
            }}
          >
            <option value="">All Actions ({total})</option>
            <option value="LOGIN">LOGIN</option>
            <option value="LOGOUT">LOGOUT</option>
            <option value="FAILED_LOGIN">FAILED_LOGIN</option>
            <option value="FIRST_RUN_SETUP">FIRST_RUN_SETUP</option>
            <option value="USER_CREATED">USER_CREATED</option>
            <option value="USER_STATUS_CHANGED">USER_STATUS_CHANGED</option>
            <option value="USER_ROLE_CHANGED">USER_ROLE_CHANGED</option>
            <option value="PASSWORD_CHANGED">PASSWORD_CHANGED</option>
            <option value="PASSWORD_RESET">PASSWORD_RESET</option>
            <option value="PROJECT_CREATED">PROJECT_CREATED</option>
            <option value="PROJECT_MEMBER_ADDED">PROJECT_MEMBER_ADDED</option>
            <option value="GIT_CREDENTIAL_CONNECTED">GIT_CREDENTIAL_CONNECTED</option>
            <option value="REVIEW_STARTED">REVIEW_STARTED</option>
            <option value="REVIEW_COMPLETED">REVIEW_COMPLETED</option>
          </select>
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="card" style={{ overflow: "hidden", padding: 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.85rem" }}>
          <thead>
            <tr style={{ background: "rgba(255, 255, 255, 0.03)", borderBottom: "1px solid var(--border)" }}>
              <th style={{ padding: "0.85rem 1rem" }}>Timestamp</th>
              <th style={{ padding: "0.85rem 1rem" }}>Action</th>
              <th style={{ padding: "0.85rem 1rem" }}>Actor</th>
              <th style={{ padding: "0.85rem 1rem" }}>Target Entity</th>
              <th style={{ padding: "0.85rem 1rem" }}>IP Address</th>
              <th style={{ padding: "0.85rem 1rem" }}>Details</th>
            </tr>
          </thead>
          <tbody>
            {filteredLogs.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: "2.5rem", textAlign: "center", color: "var(--muted)" }}>
                  {loading ? "Loading audit trail..." : "No audit records found matching criteria."}
                </td>
              </tr>
            ) : (
              filteredLogs.map((log) => (
                <tr key={log.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "0.85rem 1rem", color: "var(--muted)", fontFamily: "var(--font-mono)", fontSize: "0.8rem", whiteSpace: "nowrap" }}>
                    {new Date(log.createdAt).toLocaleString()}
                  </td>

                  <td style={{ padding: "0.85rem 1rem" }}>
                    {getActionBadge(log.action)}
                  </td>

                  <td style={{ padding: "0.85rem 1rem" }}>
                    {log.actorEmail ? (
                      <div>
                        <span style={{ fontWeight: 600, color: "var(--text)" }}>{log.actorName || log.actorEmail}</span>
                        {log.actorName && (
                          <div style={{ color: "var(--muted)", fontSize: "0.75rem", fontFamily: "var(--font-mono)" }}>
                            {log.actorEmail}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span style={{ color: "var(--muted)", fontStyle: "italic" }}>System / Anonymous</span>
                    )}
                  </td>

                  <td style={{ padding: "0.85rem 1rem" }}>
                    <span style={{
                      textTransform: "uppercase",
                      fontSize: "0.7rem",
                      fontWeight: 700,
                      color: "var(--muted)",
                      letterSpacing: "0.05em",
                      marginRight: "0.4rem"
                    }}>
                      {log.entityType}:
                    </span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--text)" }}>
                      {log.entityId}
                    </span>
                  </td>

                  <td style={{ padding: "0.85rem 1rem", color: "var(--muted)", fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}>
                    {log.ipAddress || "—"}
                  </td>

                  <td style={{ padding: "0.85rem 1rem", maxWidth: "260px" }}>
                    {log.metadata && Object.keys(log.metadata).length > 0 ? (
                      <pre
                        style={{
                          margin: 0,
                          fontSize: "0.75rem",
                          fontFamily: "var(--font-mono)",
                          background: "rgba(0, 0, 0, 0.3)",
                          padding: "0.3rem 0.5rem",
                          borderRadius: "4px",
                          overflowX: "auto",
                          maxHeight: "60px",
                          color: "#94a3b8",
                        }}
                      >
                        {JSON.stringify(log.metadata)}
                      </pre>
                    ) : (
                      <span style={{ color: "var(--muted)" }}>—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
