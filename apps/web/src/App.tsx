import { useState } from "react";
import {
  Code,
  Settings,
  History,
  Wrench,
  Menu,
  X,
  Activity,
  FolderGit2,
  Users,
  ShieldCheck,
  User,
  LogOut,
  ShieldAlert,
  Loader2,
} from "lucide-react";
import { ReviewView } from "./ReviewView.js";
import { SettingsView } from "./SettingsView.js";
import { SkillsView } from "./SkillsView.js";
import { HistoryView } from "./HistoryView.js";
import { HowItWorksView } from "./HowItWorksView.js";
import { ProjectsView } from "./ProjectsView.js";
import { UsersView } from "./UsersView.js";
import { ProfileView } from "./ProfileView.js";
import { AuditLogsView } from "./AuditLogsView.js";
import { LoginView } from "./LoginView.js";
import { SetupView } from "./SetupView.js";
import { useAuth } from "./AuthContext.js";
import { useAppConfig } from "./Settings.js";

export function App(): JSX.Element {
  const { user, isLoading, isFirstRun, logout } = useAuth();
  const [activeTab, setActiveTab] = useState("review");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [reviewTargetUrl, setReviewTargetUrl] = useState<string | undefined>(undefined);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [config] = useAppConfig();

  // Loading state
  if (isLoading) {
    return (
      <div className="auth-container">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem", color: "var(--muted)" }}>
          <Loader2 size={36} className="spin text-blue-400" />
          <span style={{ fontSize: "0.9rem" }}>Loading system configuration...</span>
        </div>
      </div>
    );
  }

  // First-run experience: redirect to dedicated setup view
  if (isFirstRun) {
    return <SetupView />;
  }

  // Unauthenticated experience: redirect to login
  if (!user) {
    return <LoginView />;
  }

  const isAdmin = user.role === "ADMIN";

  const tabs = [
    { id: "howitworks", label: "How It Works", icon: Activity },
    { id: "review", label: "Code Review", icon: Code },
    { id: "projects", label: "Projects", icon: FolderGit2 },
    ...(isAdmin
      ? [
          { id: "users", label: "Users & RBAC", icon: Users },
          { id: "audit", label: "Audit Logs", icon: ShieldCheck },
        ]
      : []),
    { id: "profile", label: "Profile & Git", icon: User },
    { id: "skills", label: "Skills & Rules", icon: Wrench },
    { id: "history", label: "History", icon: History },
    { id: "settings", label: "Settings", icon: Settings },
  ];

  const handleNavigateToReview = (url: string) => {
    setReviewTargetUrl(url);
    setActiveTab("review");
    setIsMobileMenuOpen(false);
  };

  const handleNavigateToProjects = (projectId?: string) => {
    setSelectedProjectId(projectId || null);
    setActiveTab("projects");
    setIsMobileMenuOpen(false);
  };

  const handleLogout = async () => {
    if (window.confirm("Are you sure you want to sign out?")) {
      await logout();
    }
  };

  return (
    <div className="dashboard-layout">
      {/* Mobile Header */}
      <div className="mobile-header">
        <h2>AI Review</h2>
        <button
          className="icon-btn"
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        >
          {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Sidebar */}
      <aside className={`sidebar ${isMobileMenuOpen ? "open" : ""}`} style={{ display: "flex", flexDirection: "column" }}>
        <div className="sidebar-brand">
          <h2>AI Review</h2>
          <span className="version">v0.2.0</span>
        </div>

        {config.BUDGET_LIMIT && (
          <div style={{ padding: "0 1rem", marginBottom: "1rem" }}>
            <div
              style={{
                background: "var(--panel)",
                border: "1px solid var(--border)",
                padding: "0.75rem",
                borderRadius: "8px",
                display: "flex",
                flexDirection: "column",
                gap: "0.25rem",
              }}
            >
              <span
                style={{
                  fontSize: "0.75rem",
                  color: "var(--muted)",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Max Budget
              </span>
              <span
                style={{
                  fontSize: "1.1rem",
                  fontWeight: 600,
                  color: "var(--text)",
                }}
              >
                ${parseFloat(config.BUDGET_LIMIT).toFixed(2)}
              </span>
            </div>
          </div>
        )}

        <nav className="sidebar-nav" style={{ flex: 1, overflowY: "auto" }}>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                className={`nav-item ${activeTab === tab.id ? "active" : ""}`}
                onClick={() => {
                  if (tab.id === "projects") {
                    setSelectedProjectId(null);
                  }
                  setActiveTab(tab.id);
                  setIsMobileMenuOpen(false);
                }}
              >
                <Icon size={20} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        {/* User Card at Bottom of Sidebar */}
        <div className="sidebar-user-card">
          <div
            style={{ display: "flex", alignItems: "center", gap: "0.75rem", cursor: "pointer", minWidth: 0, flex: 1 }}
            onClick={() => {
              setActiveTab("profile");
              setIsMobileMenuOpen(false);
            }}
            title="Open account profile & settings"
          >
            <div
              style={{
                width: "34px",
                height: "34px",
                borderRadius: "50%",
                background: user.role === "ADMIN" ? "linear-gradient(135deg, #8b5cf6, #ec4899)" : "linear-gradient(135deg, #3b82f6, #06b6d4)",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
                fontSize: "0.85rem",
                flexShrink: 0,
              }}
            >
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div style={{ minWidth: 0, overflow: "hidden" }}>
              <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {user.name}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                <span
                  style={{
                    fontSize: "0.65rem",
                    padding: "0.05rem 0.35rem",
                    borderRadius: "4px",
                    fontWeight: 700,
                    background: user.role === "ADMIN" ? "rgba(139, 92, 246, 0.2)" : "rgba(59, 130, 246, 0.2)",
                    color: user.role === "ADMIN" ? "#c4b5fd" : "#93c5fd",
                  }}
                >
                  {user.role}
                </span>
              </div>
            </div>
          </div>

          <button
            className="icon-btn"
            onClick={handleLogout}
            title="Sign Out"
            style={{ color: "var(--muted)" }}
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main-content">
        {activeTab === "howitworks" && <HowItWorksView />}
        {activeTab === "review" && (
          <ReviewView
            initialPrUrl={reviewTargetUrl}
            onNavigateToProjects={handleNavigateToProjects}
          />
        )}
        {activeTab === "projects" && (
          <ProjectsView
            initialProjectId={selectedProjectId}
            onSelectProject={setSelectedProjectId}
            onNavigateToReview={handleNavigateToReview}
          />
        )}
        {activeTab === "users" && (
          isAdmin ? (
            <UsersView />
          ) : (
            <div className="auth-card" style={{ margin: "3rem auto", textAlign: "center" }}>
              <ShieldAlert size={48} className="text-red-400" style={{ margin: "0 auto 1rem auto" }} />
              <h2>Access Denied</h2>
              <p>You need Administrator privileges to access user management.</p>
            </div>
          )
        )}
        {activeTab === "audit" && (
          isAdmin ? (
            <AuditLogsView />
          ) : (
            <div className="auth-card" style={{ margin: "3rem auto", textAlign: "center" }}>
              <ShieldAlert size={48} className="text-red-400" style={{ margin: "0 auto 1rem auto" }} />
              <h2>Access Denied</h2>
              <p>You need Administrator privileges to view audit logs.</p>
            </div>
          )
        )}
        {activeTab === "profile" && <ProfileView />}
        {activeTab === "skills" && <SkillsView />}
        {activeTab === "history" && <HistoryView />}
        {activeTab === "settings" && <SettingsView />}
      </main>

      {/* Backdrop for mobile */}
      {isMobileMenuOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setIsMobileMenuOpen(false)}
        ></div>
      )}
    </div>
  );
}
