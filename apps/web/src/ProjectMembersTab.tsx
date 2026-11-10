import { useState, useEffect } from "react";
import {
  Users,
  UserPlus,
  Trash2,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  X,
} from "lucide-react";
import type { ProjectRole, ProjectMemberWithUser, SafeUser } from "@ai-review/core";
import {
  fetchProjectMembers,
  addProjectMember,
  updateProjectMemberRole,
  removeProjectMember,
  fetchUsers,
} from "./api.js";
import { useAuth } from "./AuthContext.js";

interface ProjectMembersTabProps {
  projectId: string;
  userRole?: string | undefined;
}

export function ProjectMembersTab({
  projectId,
  userRole,
}: ProjectMembersTabProps): React.JSX.Element {
  const { user: currentUser } = useAuth();
  const [members, setMembers] = useState<ProjectMemberWithUser[]>([]);
  const [allUsers, setAllUsers] = useState<SafeUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Add Member Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedRole, setSelectedRole] = useState<ProjectRole>("REVIEWER");
  const [submitting, setSubmitting] = useState(false);

  const canManage =
    currentUser?.role === "ADMIN" ||
    userRole === "OWNER" ||
    userRole === "MANAGER";

  const flashSuccess = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 4000);
  };

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [membersList, usersList] = await Promise.all([
        fetchProjectMembers(projectId),
        fetchUsers().catch(() => []),
      ]);
      setMembers(membersList);
      setAllUsers(usersList);
    } catch (err: any) {
      setError(err.message || "Failed to load project members.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [projectId]);

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserId) return;

    try {
      setSubmitting(true);
      setError(null);
      await addProjectMember(projectId, selectedUserId, selectedRole);
      setShowAddModal(false);
      setSelectedUserId("");
      setSelectedRole("REVIEWER");
      flashSuccess("Team member added to project.");
      await loadData();
    } catch (err: any) {
      setError(err.message || "Failed to add member to project.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRoleChange = async (targetUserId: string, newRole: ProjectRole) => {
    try {
      setError(null);
      await updateProjectMemberRole(projectId, targetUserId, newRole);
      flashSuccess(`Member role updated to ${newRole}.`);
      await loadData();
    } catch (err: any) {
      setError(err.message || "Failed to update member role.");
    }
  };

  const handleRemove = async (targetUserId: string, memberName: string) => {
    if (!window.confirm(`Remove ${memberName} from this project?`)) {
      return;
    }

    try {
      setError(null);
      await removeProjectMember(projectId, targetUserId);
      flashSuccess("Member removed from project.");
      await loadData();
    } catch (err: any) {
      setError(err.message || "Failed to remove member.");
    }
  };

  // Filter out existing members for the Add Member dropdown
  const existingUserIds = new Set(members.map((m) => m.userId));
  const availableUsers = allUsers.filter((u) => !existingUserIds.has(u.id));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {/* Tab Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h3 style={{ fontSize: "1.1rem", fontWeight: 600, display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Users size={18} className="text-blue-400" />
            <span>Project Team & Members</span>
          </h3>
          <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: "0.25rem" }}>
            Manage who can view, run reviews, or administer this repository.
          </p>
        </div>

        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button className="btn btn-secondary" onClick={loadData} title="Refresh team members">
            <RefreshCw size={14} className={loading ? "spin" : ""} />
          </button>
          {canManage && (
            <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
              <UserPlus size={15} />
              <span>Add Member</span>
            </button>
          )}
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div className="auth-error-banner">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div style={{
          background: "rgba(16, 185, 129, 0.15)",
          border: "1px solid rgba(16, 185, 129, 0.4)",
          color: "#34d399",
          padding: "0.75rem 1rem",
          borderRadius: "8px",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          fontSize: "0.875rem"
        }}>
          <CheckCircle size={16} />
          <span>{success}</span>
        </div>
      )}

      {/* Members Table */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.85rem" }}>
          <thead>
            <tr style={{ background: "rgba(255, 255, 255, 0.03)", borderBottom: "1px solid var(--border)" }}>
              <th style={{ padding: "0.85rem 1rem" }}>Member</th>
              <th style={{ padding: "0.85rem 1rem" }}>System Role</th>
              <th style={{ padding: "0.85rem 1rem" }}>Project Role</th>
              <th style={{ padding: "0.85rem 1rem" }}>Assigned Date</th>
              {canManage && <th style={{ padding: "0.85rem 1rem", textAlign: "right" }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {members.length === 0 ? (
              <tr>
                <td colSpan={canManage ? 5 : 4} style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
                  {loading ? "Loading team members..." : "No dedicated members assigned yet. System administrators have full access."}
                </td>
              </tr>
            ) : (
              members.map((m) => {
                const isSelf = currentUser?.id === m.userId;
                return (
                  <tr key={m.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "0.85rem 1rem" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                        <div
                          style={{
                            width: "32px",
                            height: "32px",
                            borderRadius: "50%",
                            background: "rgba(59, 130, 246, 0.2)",
                            color: "#93c5fd",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontWeight: 600,
                            fontSize: "0.8rem",
                          }}
                        >
                          {m.user.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, color: "var(--text)" }}>
                            {m.user.name} {isSelf && <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>(You)</span>}
                          </div>
                          <div style={{ color: "var(--muted)", fontSize: "0.75rem", fontFamily: "var(--font-mono)" }}>
                            {m.user.email}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td style={{ padding: "0.85rem 1rem" }}>
                      <span style={{
                        fontSize: "0.75rem",
                        padding: "0.15rem 0.5rem",
                        borderRadius: "999px",
                        background: m.user.role === "ADMIN" ? "rgba(139, 92, 246, 0.15)" : "rgba(255, 255, 255, 0.05)",
                        color: m.user.role === "ADMIN" ? "#c4b5fd" : "var(--muted)",
                        border: `1px solid ${m.user.role === "ADMIN" ? "rgba(139, 92, 246, 0.3)" : "var(--border)"}`
                      }}>
                        {m.user.role}
                      </span>
                    </td>

                    <td style={{ padding: "0.85rem 1rem" }}>
                      {canManage && !isSelf ? (
                        <select
                          value={m.projectRole}
                          onChange={(e) => handleRoleChange(m.userId, e.target.value as ProjectRole)}
                          style={{
                            background: "var(--input-bg)",
                            border: "1px solid var(--border)",
                            color: "var(--text)",
                            padding: "0.3rem 0.6rem",
                            borderRadius: "6px",
                            fontSize: "0.8rem",
                            fontWeight: 600,
                          }}
                        >
                          <option value="OWNER">OWNER (Full project access)</option>
                          <option value="MANAGER">MANAGER (Manage & review)</option>
                          <option value="REVIEWER">REVIEWER (Run & view reviews)</option>
                          <option value="VIEWER">VIEWER (View only)</option>
                        </select>
                      ) : (
                        <span style={{
                          fontSize: "0.75rem",
                          fontWeight: 700,
                          padding: "0.2rem 0.6rem",
                          borderRadius: "4px",
                          background: m.projectRole === "OWNER" ? "rgba(234, 179, 8, 0.15)" : "rgba(59, 130, 246, 0.15)",
                          color: m.projectRole === "OWNER" ? "#facc15" : "#60a5fa",
                          border: `1px solid ${m.projectRole === "OWNER" ? "rgba(234, 179, 8, 0.3)" : "rgba(59, 130, 246, 0.3)"}`
                        }}>
                          {m.projectRole}
                        </span>
                      )}
                    </td>

                    <td style={{ padding: "0.85rem 1rem", color: "var(--muted)", fontSize: "0.8rem" }}>
                      {new Date(m.createdAt).toLocaleDateString()}
                    </td>

                    {canManage && (
                      <td style={{ padding: "0.85rem 1rem", textAlign: "right" }}>
                        {!isSelf && (
                          <button
                            className="icon-btn"
                            style={{ color: "#ef4444" }}
                            title="Remove member"
                            onClick={() => handleRemove(m.userId, m.user.name)}
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Add Member Modal */}
      {showAddModal && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: "460px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h3 style={{ fontSize: "1.1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <UserPlus size={18} className="text-blue-400" />
                <span>Add Member to Project</span>
              </h3>
              <button className="icon-btn" onClick={() => setShowAddModal(false)}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAddSubmit} className="auth-form">
              <div className="form-group">
                <label>Select User</label>
                {availableUsers.length === 0 ? (
                  <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                    All existing users are already members of this project.
                  </p>
                ) : (
                  <select
                    value={selectedUserId}
                    onChange={(e) => setSelectedUserId(e.target.value)}
                    required
                    style={{
                      background: "var(--input-bg)",
                      border: "1px solid var(--border)",
                      color: "var(--text)",
                      padding: "0.6rem 0.8rem",
                      borderRadius: "6px",
                      width: "100%",
                    }}
                  >
                    <option value="">-- Choose a user --</option>
                    {availableUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.email})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="form-group">
                <label>Project Role</label>
                <select
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value as ProjectRole)}
                  style={{
                    background: "var(--input-bg)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                    padding: "0.6rem 0.8rem",
                    borderRadius: "6px",
                    width: "100%",
                  }}
                >
                  <option value="VIEWER">VIEWER - Can view project & reviews</option>
                  <option value="REVIEWER">REVIEWER - Can run and view reviews</option>
                  <option value="MANAGER">MANAGER - Can manage settings and run reviews</option>
                  <option value="OWNER">OWNER - Full project control and team management</option>
                </select>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowAddModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={submitting || !selectedUserId}
                >
                  {submitting ? "Adding..." : "Add to Project"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
