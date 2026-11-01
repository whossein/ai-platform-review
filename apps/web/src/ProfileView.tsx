import React, { useState, useEffect } from "react";
import {
  User,
  Key,
  GitBranch,
  Laptop,
  CheckCircle,
  AlertCircle,
  Lock,
  Mail,
  Trash2,
  RefreshCw,
} from "lucide-react";
import type { SafeSession, GitCredentialSummary, GitCredentialProvider } from "@ai-review/core";
import {
  updateProfile,
  changePassword,
  fetchGitCredentials,
  saveGitCredential,
  deleteGitCredential,
  fetchSessions,
  revokeSession,
} from "./api.js";
import { useAuth } from "./AuthContext.js";

export function ProfileView(): JSX.Element {
  const { user, refreshUser } = useAuth();
  const [activeTab, setActiveTab] = useState<"profile" | "password" | "git" | "sessions">("profile");

  // Profile Form
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [profileSaving, setProfileSaving] = useState(false);

  // Password Form
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);

  // Git Credentials
  const [credentials, setCredentials] = useState<GitCredentialSummary[]>([]);
  const [credsLoading, setCredsLoading] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<GitCredentialProvider | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [savingCred, setSavingCred] = useState(false);

  // Sessions
  const [sessions, setSessions] = useState<SafeSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  // Status banners
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const flashSuccess = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 4000);
  };

  useEffect(() => {
    if (user) {
      setName(user.name);
      setEmail(user.email);
    }
  }, [user]);

  const loadCredentials = async () => {
    try {
      setCredsLoading(true);
      const list = await fetchGitCredentials();
      setCredentials(list);
    } catch (err: any) {
      console.warn("Error fetching credentials:", err);
    } finally {
      setCredsLoading(false);
    }
  };

  const loadSessions = async () => {
    try {
      setSessionsLoading(true);
      const list = await fetchSessions();
      setSessions(list);
    } catch (err: any) {
      console.warn("Error fetching sessions:", err);
    } finally {
      setSessionsLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === "git") {
      loadCredentials();
    } else if (activeTab === "sessions") {
      loadSessions();
    }
  }, [activeTab]);

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setProfileSaving(true);
      setError(null);
      await updateProfile({ name: name.trim(), email: email.trim() });
      await refreshUser();
      flashSuccess("Profile updated successfully.");
    } catch (err: any) {
      setError(err.message || "Failed to update profile.");
    } finally {
      setProfileSaving(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters long.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }

    try {
      setPasswordSaving(true);
      setError(null);
      await changePassword({ currentPassword, newPassword, confirmPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      flashSuccess("Password changed successfully.");
    } catch (err: any) {
      setError(err.message || "Failed to change password.");
    } finally {
      setPasswordSaving(false);
    }
  };

  const handleSaveCredential = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProvider || !tokenInput.trim()) return;

    try {
      setSavingCred(true);
      setError(null);
      await saveGitCredential(selectedProvider, tokenInput.trim());
      setSelectedProvider(null);
      setTokenInput("");
      flashSuccess(`${selectedProvider === "github" ? "GitHub" : "GitLab"} credential securely saved.`);
      await loadCredentials();
    } catch (err: any) {
      setError(err.message || "Failed to save Git credential.");
    } finally {
      setSavingCred(false);
    }
  };

  const handleRevokeCredential = async (provider: GitCredentialProvider) => {
    if (!window.confirm(`Revoke and delete your ${provider === "github" ? "GitHub" : "GitLab"} access token?`)) {
      return;
    }

    try {
      setError(null);
      await deleteGitCredential(provider);
      flashSuccess(`${provider === "github" ? "GitHub" : "GitLab"} credential revoked.`);
      await loadCredentials();
    } catch (err: any) {
      setError(err.message || "Failed to revoke credential.");
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    try {
      setError(null);
      await revokeSession(sessionId);
      flashSuccess("Session revoked.");
      await loadSessions();
    } catch (err: any) {
      setError(err.message || "Failed to revoke session.");
    }
  };

  if (!user) return <div />;

  return (
    <div className="profile-view-container" style={{ maxWidth: "800px", margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.5rem" }}>
        <div
          style={{
            width: "56px",
            height: "56px",
            borderRadius: "50%",
            background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 700,
            fontSize: "1.5rem",
          }}
        >
          {user.name.charAt(0).toUpperCase()}
        </div>
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>{user.name}</h1>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.25rem" }}>
            <span style={{ color: "var(--muted)", fontSize: "0.875rem", fontFamily: "var(--font-mono)" }}>
              {user.email}
            </span>
            <span
              style={{
                fontSize: "0.75rem",
                padding: "0.15rem 0.5rem",
                borderRadius: "999px",
                fontWeight: 600,
                background: user.role === "ADMIN" ? "rgba(139, 92, 246, 0.2)" : "rgba(59, 130, 246, 0.2)",
                color: user.role === "ADMIN" ? "#c4b5fd" : "#93c5fd",
                border: `1px solid ${user.role === "ADMIN" ? "rgba(139, 92, 246, 0.3)" : "rgba(59, 130, 246, 0.3)"}`,
              }}
            >
              {user.role}
            </span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: "0.5rem", borderBottom: "1px solid var(--border)", marginBottom: "1.5rem" }}>
        <button
          className={`tab-btn ${activeTab === "profile" ? "active" : ""}`}
          onClick={() => setActiveTab("profile")}
          style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
        >
          <User size={16} />
          <span>Profile Info</span>
        </button>
        <button
          className={`tab-btn ${activeTab === "git" ? "active" : ""}`}
          onClick={() => setActiveTab("git")}
          style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
        >
          <GitBranch size={16} />
          <span>Git Credentials</span>
        </button>
        <button
          className={`tab-btn ${activeTab === "password" ? "active" : ""}`}
          onClick={() => setActiveTab("password")}
          style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
        >
          <Key size={16} />
          <span>Change Password</span>
        </button>
        <button
          className={`tab-btn ${activeTab === "sessions" ? "active" : ""}`}
          onClick={() => setActiveTab("sessions")}
          style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
        >
          <Laptop size={16} />
          <span>Active Sessions</span>
        </button>
      </div>

      {/* Alerts */}
      {error && (
        <div className="auth-error-banner" style={{ marginBottom: "1.25rem" }}>
          <AlertCircle size={18} />
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
          marginBottom: "1.25rem",
          fontSize: "0.875rem"
        }}>
          <CheckCircle size={18} />
          <span>{success}</span>
        </div>
      )}

      {/* Tab: Profile Info */}
      {activeTab === "profile" && (
        <div className="card" style={{ padding: "1.5rem" }}>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "1rem" }}>Personal Information</h2>
          <form onSubmit={handleProfileSubmit} className="auth-form">
            <div className="form-group">
              <label>Full Name</label>
              <div className="input-with-icon">
                <User size={18} />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label>Email Address</label>
              <div className="input-with-icon">
                <Mail size={18} />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
              <button type="submit" className="btn btn-primary" disabled={profileSaving}>
                {profileSaving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Tab: Git Credentials */}
      {activeTab === "git" && (
        <div className="card" style={{ padding: "1.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <div>
              <h2 style={{ fontSize: "1.1rem", fontWeight: 600 }}>Personal Git Credentials</h2>
              <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: "0.25rem" }}>
                Credentials belong to your user account and are AES-256-GCM encrypted at rest. Used automatically when reviewing private GitHub and GitLab repositories.
              </p>
            </div>
            <button className="btn btn-secondary" onClick={loadCredentials} title="Refresh credentials">
              <RefreshCw size={14} className={credsLoading ? "spin" : ""} />
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginTop: "1.5rem" }}>
            {/* GitHub Card */}
            {(() => {
              const gh = credentials.find((c) => c.provider === "github");
              const isConnected = gh?.connected;
              return (
                <div style={{
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  padding: "1rem 1.25rem",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: isConnected ? "rgba(59, 130, 246, 0.03)" : "transparent"
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                    <div style={{
                      width: "40px",
                      height: "40px",
                      borderRadius: "8px",
                      background: "#24292e",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#fff"
                    }}>
                      <svg width="24" height="24" fill="currentColor" viewBox="0 0 24 24">
                        <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <span style={{ fontWeight: 600 }}>GitHub</span>
                        <span style={{
                          fontSize: "0.75rem",
                          padding: "0.1rem 0.5rem",
                          borderRadius: "999px",
                          fontWeight: 600,
                          background: isConnected ? "rgba(16, 185, 129, 0.15)" : "rgba(255, 255, 255, 0.05)",
                          color: isConnected ? "#34d399" : "var(--muted)",
                          border: `1px solid ${isConnected ? "rgba(16, 185, 129, 0.3)" : "var(--border)"}`
                        }}>
                          {isConnected ? "Connected" : "Not Connected"}
                        </span>
                      </div>
                      {isConnected && gh?.maskedToken && (
                        <div style={{ color: "var(--muted)", fontSize: "0.8rem", fontFamily: "var(--font-mono)", marginTop: "0.2rem" }}>
                          Token: {gh.maskedToken}
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button
                      className="btn btn-secondary"
                      onClick={() => {
                        setSelectedProvider("github");
                        setTokenInput("");
                      }}
                    >
                      {isConnected ? "Replace Token" : "Connect"}
                    </button>
                    {isConnected && (
                      <button
                        className="icon-btn"
                        style={{ color: "#ef4444" }}
                        title="Revoke Token"
                        onClick={() => handleRevokeCredential("github")}
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* GitLab Card */}
            {(() => {
              const gl = credentials.find((c) => c.provider === "gitlab");
              const isConnected = gl?.connected;
              return (
                <div style={{
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  padding: "1rem 1.25rem",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: isConnected ? "rgba(249, 115, 22, 0.03)" : "transparent"
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                    <div style={{
                      width: "40px",
                      height: "40px",
                      borderRadius: "8px",
                      background: "#fc6d26",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#fff"
                    }}>
                      <svg width="24" height="24" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.49a.42.42 0 0 1 .11-.18.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.16l2.44 7.51 1.22 3.78a.84.84 0 0 1-.3.94z" />
                      </svg>
                    </div>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <span style={{ fontWeight: 600 }}>GitLab</span>
                        <span style={{
                          fontSize: "0.75rem",
                          padding: "0.1rem 0.5rem",
                          borderRadius: "999px",
                          fontWeight: 600,
                          background: isConnected ? "rgba(16, 185, 129, 0.15)" : "rgba(255, 255, 255, 0.05)",
                          color: isConnected ? "#34d399" : "var(--muted)",
                          border: `1px solid ${isConnected ? "rgba(16, 185, 129, 0.3)" : "var(--border)"}`
                        }}>
                          {isConnected ? "Connected" : "Not Connected"}
                        </span>
                      </div>
                      {isConnected && gl?.maskedToken && (
                        <div style={{ color: "var(--muted)", fontSize: "0.8rem", fontFamily: "var(--font-mono)", marginTop: "0.2rem" }}>
                          Token: {gl.maskedToken}
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button
                      className="btn btn-secondary"
                      onClick={() => {
                        setSelectedProvider("gitlab");
                        setTokenInput("");
                      }}
                    >
                      {isConnected ? "Replace Token" : "Connect"}
                    </button>
                    {isConnected && (
                      <button
                        className="icon-btn"
                        style={{ color: "#ef4444" }}
                        title="Revoke Token"
                        onClick={() => handleRevokeCredential("gitlab")}
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Tab: Change Password */}
      {activeTab === "password" && (
        <div className="card" style={{ padding: "1.5rem" }}>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "1rem" }}>Update Account Password</h2>
          <form onSubmit={handlePasswordSubmit} className="auth-form">
            <div className="form-group">
              <label>Current Password</label>
              <div className="input-with-icon">
                <Lock size={18} />
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="••••••••••••"
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label>New Password (min. 8 characters)</label>
              <div className="input-with-icon">
                <Lock size={18} />
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••••••"
                  required
                  minLength={8}
                />
              </div>
            </div>

            <div className="form-group">
              <label>Confirm New Password</label>
              <div className="input-with-icon">
                <Lock size={18} />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••••••"
                  required
                  minLength={8}
                />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
              <button type="submit" className="btn btn-primary" disabled={passwordSaving}>
                {passwordSaving ? "Updating Password..." : "Update Password"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Tab: Active Sessions */}
      {activeTab === "sessions" && (
        <div className="card" style={{ padding: "1.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <div>
              <h2 style={{ fontSize: "1.1rem", fontWeight: 600 }}>Active Sessions</h2>
              <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: "0.25rem" }}>
                Active login sessions associated with your account across browsers and devices.
              </p>
            </div>
            <button className="btn btn-secondary" onClick={loadSessions}>
              <RefreshCw size={14} className={sessionsLoading ? "spin" : ""} />
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "1rem" }}>
            {sessions.map((s) => (
              <div
                key={s.id}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  padding: "0.875rem 1rem",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: s.isCurrent ? "rgba(59, 130, 246, 0.05)" : "transparent",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <Laptop size={20} className="text-muted" />
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <span style={{ fontSize: "0.875rem", fontWeight: 600 }}>
                        {s.userAgent ? s.userAgent.slice(0, 45) + "..." : "Browser Session"}
                      </span>
                      {s.isCurrent && (
                        <span style={{
                          fontSize: "0.7rem",
                          padding: "0.1rem 0.4rem",
                          borderRadius: "999px",
                          fontWeight: 600,
                          background: "rgba(16, 185, 129, 0.2)",
                          color: "#34d399",
                        }}>
                          Current Device
                        </span>
                      )}
                    </div>
                    <div style={{ color: "var(--muted)", fontSize: "0.75rem", fontFamily: "var(--font-mono)", marginTop: "0.15rem" }}>
                      Last active: {new Date(s.lastActiveAt).toLocaleString()} • IP: {s.ipAddress || "Unknown"}
                    </div>
                  </div>
                </div>

                {!s.isCurrent && (
                  <button
                    className="btn btn-secondary"
                    style={{ fontSize: "0.75rem", padding: "0.3rem 0.6rem", color: "#ef4444" }}
                    onClick={() => handleRevokeSession(s.id)}
                  >
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Connect/Update Git Token Modal */}
      {selectedProvider && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: "480px" }}>
            <h3 style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>
              Connect {selectedProvider === "github" ? "GitHub" : "GitLab"} Token
            </h3>
            <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: "1rem" }}>
              Provide a Personal Access Token (PAT) with read permissions to your repositories and merge requests. The token is encrypted using AES-256-GCM.
            </p>

            <form onSubmit={handleSaveCredential} className="auth-form">
              <div className="form-group">
                <label>Personal Access Token</label>
                <div className="input-with-icon">
                  <Key size={18} />
                  <input
                    type="password"
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    placeholder={selectedProvider === "github" ? "ghp_xxxxxxxxxxxx" : "glpat-xxxxxxxxxxxx"}
                    required
                    autoFocus
                  />
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setSelectedProvider(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={savingCred}
                >
                  {savingCred ? "Encrypting & Saving..." : "Save Credential"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
