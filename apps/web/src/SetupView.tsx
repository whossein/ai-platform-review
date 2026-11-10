import React, { useState } from "react";
import { UserCheck, Lock, Mail, ArrowRight, AlertCircle, Sparkles } from "lucide-react";
import { useAuth } from "./AuthContext.js";

export function SetupView(): React.JSX.Element {
  const { setupAdmin } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("Please enter your full name.");
      return;
    }
    if (!email.trim() || !email.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== passwordConfirmation) {
      setError("Passwords do not match.");
      return;
    }

    try {
      setSubmitting(true);
      await setupAdmin({
        name: name.trim(),
        email: email.trim(),
        password,
        passwordConfirmation,
      });
    } catch (err: any) {
      setError(err.message || "Failed to initialize system administrator.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card" style={{ maxWidth: "520px" }}>
        <div className="auth-header">
          <div className="auth-icon-badge" style={{ background: "rgba(139, 92, 246, 0.15)", borderColor: "rgba(139, 92, 246, 0.3)" }}>
            <img src="/icon-192.png" alt="AI Review" width={48} height={48} style={{ borderRadius: 10 }} />
          </div>
          <h2>First-Run Setup</h2>
          <p>
            Welcome to the <strong>AI Code Review Platform</strong>. To begin, create your initial root <strong>Administrator</strong> account.
          </p>
        </div>

        <div className="setup-banner" style={{
          background: "rgba(139, 92, 246, 0.08)",
          border: "1px solid rgba(139, 92, 246, 0.2)",
          borderRadius: "8px",
          padding: "0.875rem 1rem",
          marginBottom: "1.5rem",
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          fontSize: "0.85rem",
          color: "#c4b5fd"
        }}>
          <Sparkles size={18} style={{ flexShrink: 0 }} />
          <span>
            This initial account has system-wide permissions (ADMIN) to configure AI models, invite team members, and manage repository projects.
          </span>
        </div>

        {error && (
          <div className="auth-error-banner">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label>Full Name</label>
            <div className="input-with-icon">
              <UserCheck size={18} />
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Hossein Ahmadi"
                required
                autoFocus
              />
            </div>
          </div>

          <div className="form-group">
            <label>Administrator Email / Username</label>
            <div className="input-with-icon">
              <Mail size={18} />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@company.com"
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label>Password (min. 8 characters)</label>
            <div className="input-with-icon">
              <Lock size={18} />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                required
                minLength={8}
              />
            </div>
          </div>

          <div className="form-group">
            <label>Confirm Password</label>
            <div className="input-with-icon">
              <Lock size={18} />
              <input
                type="password"
                value={passwordConfirmation}
                onChange={(e) => setPasswordConfirmation(e.target.value)}
                placeholder="••••••••••••"
                required
                minLength={8}
              />
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: "100%", marginTop: "1rem", padding: "0.875rem" }}
            disabled={submitting}
          >
            {submitting ? (
              <span>Initializing System...</span>
            ) : (
              <>
                <span>Complete Setup & Sign In</span>
                <ArrowRight size={18} />
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
