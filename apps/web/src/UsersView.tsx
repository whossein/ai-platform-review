import { useState, useEffect } from "react";
import {
  Users,
  UserPlus,
  Shield,
  ShieldAlert,
  UserCheck,
  UserX,
  KeyRound,
  Trash2,
  RefreshCw,
  Search,
  AlertCircle,
  X,
  CheckCircle,
} from "lucide-react";
import type { SafeUser, UserRole, UserStatus } from "@ai-review/core";
import {
  fetchUsers,
  createUser,
  setUserRole,
  setUserStatus,
  resetUserPassword,
  deleteUser,
} from "./api.js";
import { useAuth } from "./AuthContext.js";

export function UsersView(): JSX.Element {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<SafeUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Modals state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState<SafeUser | null>(null);

  // Form states
  const [createName, setCreateName] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createRole, setCreateRole] = useState<UserRole>("MEMBER");
  const [resetPasswordVal, setResetPasswordVal] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      const list = await fetchUsers();
      setUsers(list);
    } catch (err: any) {
      setError(err.message || "Failed to load users.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const flashSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      setError(null);
      await createUser({
        name: createName.trim(),
        email: createEmail.trim(),
        password: createPassword,
        role: createRole,
      });
      setShowCreateModal(false);
      setCreateName("");
      setCreateEmail("");
      setCreatePassword("");
      setCreateRole("MEMBER");
      flashSuccess("User created successfully.");
      await loadUsers();
    } catch (err: any) {
      setError(err.message || "Failed to create user.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (user: SafeUser) => {
    const newStatus: UserStatus = user.status === "ACTIVE" ? "DISABLED" : "ACTIVE";
    const confirmMsg =
      newStatus === "DISABLED"
        ? `Are you sure you want to disable ${user.name} (${user.email})? They will immediately lose access.`
        : `Enable account for ${user.name}?`;

    if (!window.confirm(confirmMsg)) return;

    try {
      setError(null);
      await setUserStatus(user.id, newStatus);
      flashSuccess(`User status updated to ${newStatus}.`);
      await loadUsers();
    } catch (err: any) {
      setError(err.message || "Failed to update user status.");
    }
  };

  const handleToggleRole = async (user: SafeUser) => {
    const newRole: UserRole = user.role === "ADMIN" ? "MEMBER" : "ADMIN";
    const confirmMsg = `Change role for ${user.name} from ${user.role} to ${newRole}?`;
    if (!window.confirm(confirmMsg)) return;

    try {
      setError(null);
      await setUserRole(user.id, newRole);
      flashSuccess(`User role changed to ${newRole}.`);
      await loadUsers();
    } catch (err: any) {
      setError(err.message || "Failed to change user role.");
    }
  };

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showResetModal) return;

    try {
      setSubmitting(true);
      setError(null);
      await resetUserPassword(showResetModal.id, resetPasswordVal);
      setShowResetModal(null);
      setResetPasswordVal("");
      flashSuccess(`Password for ${showResetModal.email} has been reset.`);
    } catch (err: any) {
      setError(err.message || "Failed to reset password.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteUser = async (user: SafeUser) => {
    if (!window.confirm(`Permanently delete user ${user.name} (${user.email})? This action cannot be undone.`)) {
      return;
    }

    try {
      setError(null);
      await deleteUser(user.id);
      flashSuccess(`User ${user.email} was deleted.`);
      await loadUsers();
    } catch (err: any) {
      setError(err.message || "Failed to delete user.");
    }
  };

  const filteredUsers = users.filter((u) => {
    const q = search.toLowerCase();
    return (
      u.name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.role.toLowerCase().includes(q)
    );
  });

  return (
    <div className="users-view-container">
      {/* Header */}
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "1.5rem", fontWeight: 700 }}>
            <Users size={24} className="text-blue-400" />
            <span>User Management & RBAC</span>
          </h1>
          <p style={{ color: "var(--muted)", fontSize: "0.875rem", marginTop: "0.25rem" }}>
            Manage platform accounts, role-based system privileges, and access control.
          </p>
        </div>

        <div style={{ display: "flex", gap: "0.75rem" }}>
          <button className="btn btn-secondary" onClick={loadUsers} title="Refresh users list">
            <RefreshCw size={16} className={loading ? "spin" : ""} />
            <span>Refresh</span>
          </button>
          <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
            <UserPlus size={16} />
            <span>Create User</span>
          </button>
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div className="auth-error-banner" style={{ marginBottom: "1rem" }}>
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div style={{
          background: "rgba(16, 185, 129, 0.15)",
          border: "1px solid rgba(16, 185, 129, 0.4)",
          color: "#34d399",
          padding: "0.75rem 1rem",
          borderRadius: "8px",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          marginBottom: "1rem",
          fontSize: "0.875rem"
        }}>
          <CheckCircle size={18} />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Search and Filters */}
      <div style={{ marginBottom: "1.25rem", display: "flex", gap: "1rem" }}>
        <div className="input-with-icon" style={{ flex: 1, maxWidth: "400px" }}>
          <Search size={16} />
          <input
            type="text"
            placeholder="Search users by name, email, or role..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Users Table */}
      <div className="card" style={{ overflow: "hidden", padding: 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.875rem" }}>
          <thead>
            <tr style={{ background: "rgba(255, 255, 255, 0.03)", borderBottom: "1px solid var(--border)" }}>
              <th style={{ padding: "0.875rem 1rem" }}>User</th>
              <th style={{ padding: "0.875rem 1rem" }}>Role</th>
              <th style={{ padding: "0.875rem 1rem" }}>Status</th>
              <th style={{ padding: "0.875rem 1rem" }}>Created</th>
              <th style={{ padding: "0.875rem 1rem" }}>Last Login</th>
              <th style={{ padding: "0.875rem 1rem", textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
                  {loading ? "Loading users..." : "No users found matching query."}
                </td>
              </tr>
            ) : (
              filteredUsers.map((u) => {
                const isSelf = currentUser?.id === u.id;
                return (
                  <tr key={u.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "0.875rem 1rem" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                        <div
                          style={{
                            width: "36px",
                            height: "36px",
                            borderRadius: "50%",
                            background: u.role === "ADMIN" ? "rgba(139, 92, 246, 0.2)" : "rgba(59, 130, 246, 0.2)",
                            color: u.role === "ADMIN" ? "#c4b5fd" : "#93c5fd",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontWeight: 600,
                            fontSize: "0.875rem",
                          }}
                        >
                          {u.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, color: "var(--text)" }}>
                            {u.name} {isSelf && <span style={{ fontSize: "0.75rem", color: "var(--muted)", fontWeight: 400 }}>(You)</span>}
                          </div>
                          <div style={{ color: "var(--muted)", fontSize: "0.8rem", fontFamily: "var(--font-mono)" }}>
                            {u.email}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td style={{ padding: "0.875rem 1rem" }}>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.25rem",
                          padding: "0.2rem 0.6rem",
                          borderRadius: "999px",
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          background: u.role === "ADMIN" ? "rgba(139, 92, 246, 0.15)" : "rgba(59, 130, 246, 0.15)",
                          color: u.role === "ADMIN" ? "#a78bfa" : "#60a5fa",
                          border: `1px solid ${u.role === "ADMIN" ? "rgba(139, 92, 246, 0.3)" : "rgba(59, 130, 246, 0.3)"}`,
                        }}
                      >
                        {u.role === "ADMIN" ? <Shield size={12} /> : <UserCheck size={12} />}
                        <span>{u.role}</span>
                      </span>
                    </td>

                    <td style={{ padding: "0.875rem 1rem" }}>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.25rem",
                          padding: "0.2rem 0.6rem",
                          borderRadius: "999px",
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          background: u.status === "ACTIVE" ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)",
                          color: u.status === "ACTIVE" ? "#34d399" : "#f87171",
                          border: `1px solid ${u.status === "ACTIVE" ? "rgba(16, 185, 129, 0.3)" : "rgba(239, 68, 68, 0.3)"}`,
                        }}
                      >
                        {u.status === "ACTIVE" ? "Active" : "Disabled"}
                      </span>
                    </td>

                    <td style={{ padding: "0.875rem 1rem", color: "var(--muted)", fontSize: "0.8rem" }}>
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>

                    <td style={{ padding: "0.875rem 1rem", color: "var(--muted)", fontSize: "0.8rem" }}>
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "Never"}
                    </td>

                    <td style={{ padding: "0.875rem 1rem", textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: "0.35rem" }}>
                        {/* Change Role */}
                        <button
                          className="icon-btn"
                          title={`Switch role to ${u.role === "ADMIN" ? "MEMBER" : "ADMIN"}`}
                          onClick={() => handleToggleRole(u)}
                        >
                          <ShieldAlert size={16} />
                        </button>

                        {/* Reset Password */}
                        <button
                          className="icon-btn"
                          title="Reset Password"
                          onClick={() => setShowResetModal(u)}
                        >
                          <KeyRound size={16} />
                        </button>

                        {/* Toggle Status */}
                        <button
                          className="icon-btn"
                          title={u.status === "ACTIVE" ? "Disable User" : "Enable User"}
                          onClick={() => handleToggleStatus(u)}
                        >
                          {u.status === "ACTIVE" ? <UserX size={16} /> : <UserCheck size={16} />}
                        </button>

                        {/* Delete User */}
                        <button
                          className="icon-btn"
                          title="Delete User"
                          style={{ color: "#ef4444" }}
                          onClick={() => handleDeleteUser(u)}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Create User Modal */}
      {showCreateModal && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: "480px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h3 style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "1.1rem" }}>
                <UserPlus size={18} className="text-blue-400" />
                <span>Create New User</span>
              </h3>
              <button className="icon-btn" onClick={() => setShowCreateModal(false)}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="auth-form">
              <div className="form-group">
                <label>Full Name</label>
                <input
                  type="text"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="e.g. Sara Rad"
                  required
                />
              </div>

              <div className="form-group">
                <label>Email Address</label>
                <input
                  type="email"
                  value={createEmail}
                  onChange={(e) => setCreateEmail(e.target.value)}
                  placeholder="user@company.com"
                  required
                />
              </div>

              <div className="form-group">
                <label>Initial Password (min. 8 characters)</label>
                <input
                  type="password"
                  value={createPassword}
                  onChange={(e) => setCreatePassword(e.target.value)}
                  placeholder="••••••••••••"
                  required
                  minLength={8}
                />
              </div>

              <div className="form-group">
                <label>System Role</label>
                <select
                  value={createRole}
                  onChange={(e) => setCreateRole(e.target.value as UserRole)}
                  style={{
                    background: "var(--input-bg)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                    padding: "0.6rem 0.8rem",
                    borderRadius: "6px",
                    width: "100%",
                  }}
                >
                  <option value="MEMBER">MEMBER (Standard User)</option>
                  <option value="ADMIN">ADMIN (Full System Access)</option>
                </select>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowCreateModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={submitting}
                >
                  {submitting ? "Creating..." : "Create User"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {showResetModal && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: "440px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h3 style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "1.1rem" }}>
                <KeyRound size={18} className="text-purple-400" />
                <span>Reset User Password</span>
              </h3>
              <button className="icon-btn" onClick={() => setShowResetModal(null)}>
                <X size={18} />
              </button>
            </div>

            <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "1rem" }}>
              Set a new password for <strong>{showResetModal.name}</strong> ({showResetModal.email}). All active sessions for this user will be revoked.
            </p>

            <form onSubmit={handleResetSubmit} className="auth-form">
              <div className="form-group">
                <label>New Password (min. 8 characters)</label>
                <input
                  type="password"
                  value={resetPasswordVal}
                  onChange={(e) => setResetPasswordVal(e.target.value)}
                  placeholder="••••••••••••"
                  required
                  minLength={8}
                  autoFocus
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowResetModal(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={submitting}
                >
                  {submitting ? "Resetting..." : "Confirm Password Reset"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
