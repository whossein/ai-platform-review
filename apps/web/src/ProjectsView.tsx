import { useState, useEffect, useMemo } from "react";
import {
  FolderGit2,
  Plus,
  GitPullRequest,
  ExternalLink,
  Search,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  ArrowRight,
  ShieldCheck,
  Award,
  Sparkles,
  BrainCircuit,
  Pencil,
  Save,
  X,
  FileText,
  Users,
} from "lucide-react";
import {
  fetchProjects,
  fetchProjectDetails,
  createProject,
  updateProject,
  deleteProject,
  type ProjectWithStats,
  type ProjectDetailsResponse,
} from "./api.js";
import { parseRepositoryUrl } from "./url-helper.js";
import { ProjectMembersTab } from "./ProjectMembersTab.js";

interface ProjectsViewProps {
  initialProjectId?: string | null | undefined;
  onSelectProject?: ((id: string | null) => void) | undefined;
  onNavigateToReview?: ((mrOrRepoUrl: string) => void) | undefined;
}

export function ProjectsView({
  initialProjectId = null,
  onSelectProject,
  onNavigateToReview,
}: ProjectsViewProps): JSX.Element {
  const [projects, setProjects] = useState<ProjectWithStats[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedProjectId, setSelectedProjectIdState] = useState<string | null>(initialProjectId);

  const setSelectedProjectId = (id: string | null) => {
    setSelectedProjectIdState(id);
    if (onSelectProject) onSelectProject(id);
  };

  useEffect(() => {
    if (initialProjectId !== undefined) {
      setSelectedProjectIdState(initialProjectId);
    }
  }, [initialProjectId]);
  const [projectDetails, setProjectDetails] = useState<ProjectDetailsResponse | null>(null);
  const [activeTab, setActiveTab] = useState<"mrs" | "reviews" | "identity" | "instructions" | "members">("mrs");

  // Create Project Modal state
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [repoUrlInput, setRepoUrlInput] = useState<string>("");
  const [nameInput, setNameInput] = useState<string>("");
  const [descriptionInput, setDescriptionInput] = useState<string>("");
  const [instructionsInput, setInstructionsInput] = useState<string>("");
  const [creating, setCreating] = useState<boolean>(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);

  // Edit Project Guidelines & Details state
  const [isEditingGuidelines, setIsEditingGuidelines] = useState<boolean>(false);
  const [editName, setEditName] = useState<string>("");
  const [editDescription, setEditDescription] = useState<string>("");
  const [editInstructions, setEditInstructions] = useState<string>("");
  const [savingGuidelines, setSavingGuidelines] = useState<boolean>(false);
  const [guidelinesError, setGuidelinesError] = useState<string | null>(null);
  const [guidelinesSuccess, setGuidelinesSuccess] = useState<string | null>(null);

  // Load projects list
  const loadProjects = async () => {
    try {
      setLoading(true);
      const list = await fetchProjects();
      setProjects(list);
    } catch (e: any) {
      console.error("Failed to load projects:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadProjects();
  }, []);

  // Load selected project details
  useEffect(() => {
    if (!selectedProjectId) {
      setProjectDetails(null);
      setIsEditingGuidelines(false);
      return;
    }
    const loadDetails = async () => {
      try {
        const details = await fetchProjectDetails(selectedProjectId);
        setProjectDetails(details);
        setEditName(details.project.name || "");
        setEditDescription(details.project.description || "");
        setEditInstructions(details.project.customInstructions || "");
      } catch (err: any) {
        console.error("Failed to load project details:", err);
      }
    };
    void loadDetails();
  }, [selectedProjectId]);

  // Real-time parsing of repo URL in creation modal
  const parsedModalRepo = useMemo(() => {
    return parseRepositoryUrl(repoUrlInput);
  }, [repoUrlInput]);

  // Real-time duplicate check
  const duplicateProject = useMemo(() => {
    if (!parsedModalRepo) return null;
    return (
      projects.find(
        (p) =>
          `${p.gitHost.toLowerCase()}/${p.repositoryPath.toLowerCase()}` ===
          parsedModalRepo.identityKey,
      ) || null
    );
  }, [parsedModalRepo, projects]);

  const handleOpenCreateModal = () => {
    setRepoUrlInput("");
    setNameInput("");
    setDescriptionInput("");
    setInstructionsInput("");
    setCreateError(null);
    setCreateSuccess(null);
    setIsModalOpen(true);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoUrlInput.trim()) {
      setCreateError("Please enter a repository URL");
      return;
    }
    if (!parsedModalRepo) {
      setCreateError("Invalid repository URL format. Please provide a valid URL.");
      return;
    }
    if (duplicateProject) {
      setCreateError(
        `This repository is already registered as project "${duplicateProject.name}".`,
      );
      return;
    }

    try {
      setCreating(true);
      setCreateError(null);
      const newProject = await createProject({
        repositoryUrl: repoUrlInput.trim(),
        name: nameInput.trim() ? nameInput.trim() : undefined,
        description: descriptionInput.trim() ? descriptionInput.trim() : undefined,
        customInstructions: instructionsInput.trim() ? instructionsInput.trim() : undefined,
      });
      setCreateSuccess(`Project "${newProject.name}" created successfully!`);
      await loadProjects();
      setTimeout(() => {
        setIsModalOpen(false);
        setSelectedProjectId(newProject.id);
      }, 1000);
    } catch (err: any) {
      setCreateError(err.message || "Failed to create project");
    } finally {
      setCreating(false);
    }
  };

  const handleSaveGuidelines = async () => {
    if (!projectDetails) return;
    try {
      setSavingGuidelines(true);
      setGuidelinesError(null);
      setGuidelinesSuccess(null);
      const updated = await updateProject(projectDetails.project.id, {
        name: editName.trim() || undefined,
        description: editDescription.trim() || undefined,
        customInstructions: editInstructions.trim() || undefined,
      });
      setProjectDetails({
        ...projectDetails,
        project: updated,
      });
      setGuidelinesSuccess("✓ System instructions & project settings saved! AI reviewers will now apply these guidelines.");
      setIsEditingGuidelines(false);
      await loadProjects();
      setTimeout(() => setGuidelinesSuccess(null), 4000);
    } catch (err: any) {
      setGuidelinesError(err.message || "Failed to save guidelines");
    } finally {
      setSavingGuidelines(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (
      !window.confirm(
        `Are you sure you want to delete project "${name}"? This will remove its registry entry and associated reviews.`,
      )
    ) {
      return;
    }
    try {
      await deleteProject(id);
      if (selectedProjectId === id) {
        setSelectedProjectId(null);
      }
      await loadProjects();
    } catch (e: any) {
      alert(e.message || "Failed to delete project");
    }
  };

  // Filtered projects
  const filteredProjects = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return projects;
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.gitHost.toLowerCase().includes(q) ||
        p.repositoryPath.toLowerCase().includes(q) ||
        p.namespace.toLowerCase().includes(q),
    );
  }, [projects, searchQuery]);

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "1.5rem" }}>
      {/* Top Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "1.5rem",
          flexWrap: "wrap",
          gap: "1rem",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <h1 style={{ margin: 0, fontSize: "1.6rem", fontWeight: 700 }}>
              Projects
            </h1>
            <span
              style={{
                fontSize: "0.75rem",
                fontWeight: 600,
                background: "var(--panel)",
                border: "1px solid var(--border)",
                padding: "0.2rem 0.6rem",
                borderRadius: "999px",
                color: "var(--accent)",
              }}
            >
              {projects.length} {projects.length === 1 ? "Repository" : "Repositories"}
            </span>
          </div>
          <p
            style={{
              margin: "0.25rem 0 0",
              color: "var(--muted)",
              fontSize: "0.9rem",
            }}
          >
            First-class project entities uniquely identified by git host and repository path.
          </p>
        </div>

        <button
          className="run-btn"
          style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
          onClick={handleOpenCreateModal}
        >
          <Plus size={18} />
          <span>New Project</span>
        </button>
      </div>

      {/* Main View: Either Selected Project Details OR Projects List */}
      {selectedProjectId && projectDetails ? (
        /* ------------------ Project Details View ------------------ */
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {/* Breadcrumb Navigation */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              fontSize: "0.85rem",
              color: "var(--muted)",
            }}
          >
            <button
              onClick={() => setSelectedProjectId(null)}
              style={{
                background: "none",
                border: "none",
                color: "var(--accent)",
                cursor: "pointer",
                padding: 0,
                fontWeight: 500,
              }}
            >
              ← Back to All Projects
            </button>
            <span>/</span>
            <span style={{ color: "var(--text)", fontWeight: 600 }}>
              {projectDetails.project.name}
            </span>
          </div>

          {/* Project Summary Banner */}
          <div
            className="project-header-row responsive-url-box"
            style={{
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderRadius: "12px",
              padding: "1.5rem",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              flexWrap: "wrap",
              gap: "1.5rem",
              minWidth: 0,
              maxWidth: "100%",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", minWidth: 0, flex: "1 1 280px", maxWidth: "100%" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", minWidth: 0 }}>
                <h2 style={{ margin: 0, fontSize: "1.4rem", wordBreak: "break-word" }}>
                  {projectDetails.project.name}
                </h2>
                <span
                  style={{
                    fontSize: "0.75rem",
                    padding: "0.2rem 0.6rem",
                    borderRadius: "6px",
                    background: "rgba(59, 130, 246, 0.15)",
                    color: "var(--accent)",
                    border: "1px solid rgba(59, 130, 246, 0.3)",
                    fontFamily: "ui-monospace, monospace",
                    wordBreak: "break-all",
                  }}
                >
                  {projectDetails.project.gitHost}
                </span>
                {projectDetails.project.namespace && (
                  <span
                    style={{
                      fontSize: "0.75rem",
                      padding: "0.2rem 0.6rem",
                      borderRadius: "6px",
                      background: "rgba(139, 148, 158, 0.15)",
                      color: "var(--muted)",
                      border: "1px solid var(--border)",
                      fontFamily: "ui-monospace, monospace",
                      wordBreak: "break-all",
                    }}
                  >
                    {projectDetails.project.namespace}
                  </span>
                )}
                {projectDetails.project.customInstructions ? (
                  <button
                    type="button"
                    onClick={() => setActiveTab("instructions")}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.35rem",
                      background: "rgba(168, 85, 247, 0.15)",
                      border: "1px solid rgba(168, 85, 247, 0.35)",
                      color: "#c084fc",
                      padding: "0.2rem 0.6rem",
                      borderRadius: "999px",
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                    title="Click to view/edit AI system instructions"
                  >
                    <BrainCircuit size={12} />
                    <span>AI Guidelines Active ({projectDetails.project.customInstructions.length} chars)</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab("instructions");
                      setIsEditingGuidelines(true);
                    }}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.35rem",
                      background: "rgba(255, 255, 255, 0.05)",
                      border: "1px dashed var(--border)",
                      color: "var(--muted)",
                      padding: "0.2rem 0.6rem",
                      borderRadius: "999px",
                      fontSize: "0.75rem",
                      cursor: "pointer",
                    }}
                    title="Add project-specific AI system context"
                  >
                    <Plus size={12} />
                    <span>Add AI Guidelines</span>
                  </button>
                )}
              </div>

              {projectDetails.project.description && (
                <p style={{ margin: "0.1rem 0 0", color: "var(--muted)", fontSize: "0.85rem", wordBreak: "break-word" }}>
                  {projectDetails.project.description}
                </p>
              )}

              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", minWidth: 0, maxWidth: "100%" }}>
                <a
                  href={projectDetails.project.repositoryUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="url-link"
                  style={{
                    color: "var(--muted)",
                    fontSize: "0.85rem",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.3rem",
                    textDecoration: "none",
                    minWidth: 0,
                    maxWidth: "100%",
                  }}
                  onMouseEnter={(e) => ((e.target as HTMLElement).style.color = "var(--accent)")}
                  onMouseLeave={(e) => ((e.target as HTMLElement).style.color = "var(--muted)")}
                >
                  <span className="break-url" style={{ fontFamily: "ui-monospace, monospace", wordBreak: "break-all", overflowWrap: "anywhere" }}>
                    {projectDetails.project.repositoryUrl}
                  </span>
                  <ExternalLink size={14} style={{ flexShrink: 0 }} />
                </a>
              </div>

              <div
                style={{
                  fontSize: "0.8rem",
                  color: "var(--muted)",
                  marginTop: "0.25rem",
                  display: "flex",
                  gap: "1.5rem",
                  flexWrap: "wrap",
                }}
              >
                <span>
                  Created:{" "}
                  {new Date(projectDetails.project.createdAt).toLocaleDateString(
                    undefined,
                    { year: "numeric", month: "short", day: "numeric" },
                  )}
                </span>
                <span>
                  Updated:{" "}
                  {new Date(projectDetails.project.updatedAt).toLocaleDateString(
                    undefined,
                    { year: "numeric", month: "short", day: "numeric" },
                  )}
                </span>
              </div>
            </div>

            <div className="project-actions-row" style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => {
                  setActiveTab("instructions");
                  setIsEditingGuidelines(true);
                }}
                style={{
                  background: "rgba(168, 85, 247, 0.15)",
                  border: "1px solid rgba(168, 85, 247, 0.35)",
                  color: "#c084fc",
                  borderRadius: "8px",
                  padding: "0.5rem 0.85rem",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.4rem",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                }}
                title="Edit AI system guidelines, name, and description"
              >
                <BrainCircuit size={16} />
                <span>AI Guidelines</span>
              </button>
              {onNavigateToReview && (
                <button
                  className="run-btn"
                  onClick={() => onNavigateToReview(projectDetails.project.repositoryUrl)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.4rem",
                    fontSize: "0.85rem",
                    padding: "0.5rem 1rem",
                  }}
                >
                  <Sparkles size={16} />
                  <span>Review Code</span>
                </button>
              )}
              <button
                onClick={() =>
                  handleDelete(projectDetails.project.id, projectDetails.project.name)
                }
                style={{
                  background: "transparent",
                  border: "1px solid var(--border)",
                  color: "var(--critical)",
                  borderRadius: "8px",
                  padding: "0.5rem 0.8rem",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.4rem",
                  fontSize: "0.85rem",
                }}
              >
                <Trash2 size={16} />
                <span>Delete</span>
              </button>
            </div>
          </div>

          {/* Metric Stat Cards */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "1rem",
            }}
          >
            <div
              style={{
                background: "var(--panel)",
                border: "1px solid var(--border)",
                borderRadius: "10px",
                padding: "1rem",
                display: "flex",
                flexDirection: "column",
                gap: "0.25rem",
              }}
            >
              <span style={{ fontSize: "0.8rem", color: "var(--muted)", fontWeight: 600 }}>
                MERGE REQUESTS
              </span>
              <span style={{ fontSize: "1.8rem", fontWeight: 700, color: "var(--text)" }}>
                {projectDetails.stats.mergeRequestCount}
              </span>
              <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                Tracked change requests
              </span>
            </div>

            <div
              style={{
                background: "var(--panel)",
                border: "1px solid var(--border)",
                borderRadius: "10px",
                padding: "1rem",
                display: "flex",
                flexDirection: "column",
                gap: "0.25rem",
              }}
            >
              <span style={{ fontSize: "0.8rem", color: "var(--muted)", fontWeight: 600 }}>
                TOTAL REVIEWS
              </span>
              <span style={{ fontSize: "1.8rem", fontWeight: 700, color: "var(--text)" }}>
                {projectDetails.stats.reviewCount}
              </span>
              <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                AI specialist evaluations
              </span>
            </div>

            <div
              style={{
                background: "var(--panel)",
                border: "1px solid var(--border)",
                borderRadius: "10px",
                padding: "1rem",
                display: "flex",
                flexDirection: "column",
                gap: "0.25rem",
              }}
            >
              <span style={{ fontSize: "0.8rem", color: "var(--muted)", fontWeight: 600 }}>
                AVERAGE QUALITY SCORE
              </span>
              <span
                style={{
                  fontSize: "1.8rem",
                  fontWeight: 700,
                  color:
                    projectDetails.stats.averageScore !== undefined
                      ? projectDetails.stats.averageScore >= 80
                        ? "var(--low)"
                        : projectDetails.stats.averageScore >= 60
                          ? "var(--medium)"
                          : "var(--critical)"
                      : "var(--muted)",
                }}
              >
                {projectDetails.stats.averageScore !== undefined
                  ? `${projectDetails.stats.averageScore}/100`
                  : "N/A"}
              </span>
              <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                Across completed reviews
              </span>
            </div>

            <div
              style={{
                background: "var(--panel)",
                border: "1px solid var(--border)",
                borderRadius: "10px",
                padding: "1rem",
                display: "flex",
                flexDirection: "column",
                gap: "0.25rem",
              }}
            >
              <span style={{ fontSize: "0.8rem", color: "var(--muted)", fontWeight: 600 }}>
                LATEST ACTIVITY
              </span>
              <span style={{ fontSize: "1.1rem", fontWeight: 600, color: "var(--text)", marginTop: "0.25rem" }}>
                {projectDetails.stats.latestReview
                  ? new Date(projectDetails.stats.latestReview.timestamp).toLocaleDateString()
                  : "No reviews yet"}
              </span>
              <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                {projectDetails.stats.latestReview
                  ? `Model: ${projectDetails.stats.latestReview.model}`
                  : "Submit an MR to begin"}
              </span>
            </div>
          </div>

          {/* Subtabs Navigation */}
          <div
            style={{
              display: "flex",
              gap: "0.5rem",
              borderBottom: "1px solid var(--border)",
              paddingBottom: "0.5rem",
            }}
          >
            <button
              onClick={() => setActiveTab("mrs")}
              style={{
                background: activeTab === "mrs" ? "var(--panel)" : "transparent",
                border: activeTab === "mrs" ? "1px solid var(--border)" : "1px solid transparent",
                color: activeTab === "mrs" ? "var(--text)" : "var(--muted)",
                padding: "0.5rem 1rem",
                borderRadius: "8px",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: "0.85rem",
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
              }}
            >
              <GitPullRequest size={16} />
              <span>Merge Requests ({projectDetails.mergeRequests.length})</span>
            </button>

            <button
              onClick={() => setActiveTab("reviews")}
              style={{
                background: activeTab === "reviews" ? "var(--panel)" : "transparent",
                border: activeTab === "reviews" ? "1px solid var(--border)" : "1px solid transparent",
                color: activeTab === "reviews" ? "var(--text)" : "var(--muted)",
                padding: "0.5rem 1rem",
                borderRadius: "8px",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: "0.85rem",
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
              }}
            >
              <Award size={16} />
              <span>Review History ({projectDetails.reviews.length})</span>
            </button>

            <button
              onClick={() => setActiveTab("identity")}
              style={{
                background: activeTab === "identity" ? "var(--panel)" : "transparent",
                border: activeTab === "identity" ? "1px solid var(--border)" : "1px solid transparent",
                color: activeTab === "identity" ? "var(--text)" : "var(--muted)",
                padding: "0.5rem 1rem",
                borderRadius: "8px",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: "0.85rem",
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
              }}
            >
              <ShieldCheck size={16} />
              <span>Identity & Deduplication</span>
            </button>

            <button
              onClick={() => setActiveTab("instructions")}
              style={{
                background: activeTab === "instructions" ? "var(--panel)" : "transparent",
                border: activeTab === "instructions" ? "1px solid var(--border)" : "1px solid transparent",
                color: activeTab === "instructions" ? "var(--text)" : "var(--muted)",
                padding: "0.5rem 1rem",
                borderRadius: "8px",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: "0.85rem",
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
              }}
            >
              <BrainCircuit size={16} />
              <span>AI System Guidelines {projectDetails.project.customInstructions ? "✓" : ""}</span>
            </button>

            <button
              onClick={() => setActiveTab("members")}
              style={{
                background: activeTab === "members" ? "var(--panel)" : "transparent",
                border: activeTab === "members" ? "1px solid var(--border)" : "1px solid transparent",
                color: activeTab === "members" ? "var(--text)" : "var(--muted)",
                padding: "0.5rem 1rem",
                borderRadius: "8px",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: "0.85rem",
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
              }}
            >
              <Users size={16} />
              <span>Team & Members</span>
            </button>
          </div>

          {/* Subtab 1: Merge Requests */}
          {activeTab === "mrs" && (
            <div>
              {projectDetails.mergeRequests.length === 0 ? (
                <div
                  style={{
                    background: "var(--panel)",
                    border: "1px solid var(--border)",
                    borderRadius: "10px",
                    padding: "3rem",
                    textAlign: "center",
                    color: "var(--muted)",
                  }}
                >
                  <GitPullRequest size={40} style={{ margin: "0 auto 1rem", opacity: 0.5 }} />
                  <h3 style={{ margin: "0 0 0.5rem", color: "var(--text)" }}>
                    No Merge Requests Recorded Yet
                  </h3>
                  <p style={{ margin: 0, fontSize: "0.9rem", maxWidth: "450px", marginInline: "auto" }}>
                    When you enter a Merge Request URL from this repository in the Code Review tab, it will automatically link here!
                  </p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  {projectDetails.mergeRequests.map((mr) => (
                    <div
                      key={mr.id}
                      className="mr-list-item responsive-url-box"
                      style={{
                        background: "var(--panel)",
                        border: "1px solid var(--border)",
                        borderRadius: "8px",
                        padding: "1rem",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: "1rem",
                        minWidth: 0,
                        maxWidth: "100%",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", minWidth: 0, flex: "1 1 260px", maxWidth: "100%" }}>
                        <div
                          style={{
                            background: "rgba(59, 130, 246, 0.15)",
                            color: "var(--accent)",
                            padding: "0.5rem",
                            borderRadius: "8px",
                            flexShrink: 0,
                          }}
                        >
                          <GitPullRequest size={20} />
                        </div>
                        <div style={{ minWidth: 0, flex: 1, maxWidth: "100%" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", minWidth: 0 }}>
                            <span style={{ fontWeight: 600, color: "var(--text)" }}>
                              MR #{mr.mrNumber}
                            </span>
                            <a
                              href={mr.url}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                color: "var(--muted)",
                                fontSize: "0.8rem",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "0.2rem",
                                textDecoration: "none",
                              }}
                            >
                              <ExternalLink size={12} />
                            </a>
                          </div>
                          <div
                            className="break-url"
                            style={{
                              fontSize: "0.75rem",
                              color: "var(--muted)",
                              fontFamily: "ui-monospace, monospace",
                              wordBreak: "break-all",
                              overflowWrap: "anywhere",
                              marginTop: "0.2rem",
                              minWidth: 0,
                            }}
                          >
                            {mr.url}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap", minWidth: 0 }}>
                        <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                          First recorded: {new Date(mr.createdAt).toLocaleDateString()}
                        </span>
                        {onNavigateToReview && (
                          <button
                            onClick={() => onNavigateToReview(mr.url)}
                            style={{
                              background: "rgba(59, 130, 246, 0.15)",
                              border: "1px solid rgba(59, 130, 246, 0.3)",
                              color: "var(--accent)",
                              borderRadius: "6px",
                              padding: "0.4rem 0.75rem",
                              fontSize: "0.8rem",
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              gap: "0.3rem",
                              fontWeight: 500,
                            }}
                          >
                            <span>Review MR</span>
                            <ArrowRight size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Subtab 2: Review History */}
          {activeTab === "reviews" && (
            <div>
              {projectDetails.reviews.length === 0 ? (
                <div
                  style={{
                    background: "var(--panel)",
                    border: "1px solid var(--border)",
                    borderRadius: "10px",
                    padding: "3rem",
                    textAlign: "center",
                    color: "var(--muted)",
                  }}
                >
                  <Award size={40} style={{ margin: "0 auto 1rem", opacity: 0.5 }} />
                  <h3 style={{ margin: "0 0 0.5rem", color: "var(--text)" }}>
                    No Reviews for this Project Yet
                  </h3>
                  <p style={{ margin: 0, fontSize: "0.9rem" }}>
                    Run a code review on any diff or MR from this repository to view evaluations and scores here.
                  </p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  {projectDetails.reviews.map((rev) => (
                    <div
                      key={rev.id}
                      style={{
                        background: "var(--panel)",
                        border: "1px solid var(--border)",
                        borderRadius: "8px",
                        padding: "1rem",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: "1rem",
                      }}
                    >
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                          <span
                            style={{
                              fontSize: "0.75rem",
                              fontWeight: 700,
                              padding: "0.2rem 0.5rem",
                              borderRadius: "4px",
                              background:
                                (rev.score ?? 100) >= 80
                                  ? "rgba(63, 185, 80, 0.2)"
                                  : (rev.score ?? 100) >= 60
                                    ? "rgba(210, 153, 34, 0.2)"
                                    : "rgba(248, 81, 73, 0.2)",
                              color:
                                (rev.score ?? 100) >= 80
                                  ? "var(--low)"
                                  : (rev.score ?? 100) >= 60
                                    ? "var(--medium)"
                                    : "var(--critical)",
                            }}
                          >
                            Score: {rev.score ?? 100}/100
                          </span>
                          <span style={{ fontSize: "0.85rem", color: "var(--text)", fontWeight: 600 }}>
                            {rev.model}
                          </span>
                          <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                            {new Date(rev.timestamp).toLocaleString()}
                          </span>
                        </div>

                        <div
                          style={{
                            fontSize: "0.8rem",
                            color: "var(--muted)",
                            marginTop: "0.3rem",
                            display: "flex",
                            gap: "1rem",
                          }}
                        >
                          <span>Issues Found: {rev.issuesCount}</span>
                          <span>Accepted: {rev.acceptedCount}</span>
                          {rev.criticalCount > 0 && (
                            <span style={{ color: "var(--critical)" }}>
                              Critical: {rev.criticalCount}
                            </span>
                          )}
                          {rev.highCount > 0 && (
                            <span style={{ color: "var(--high)" }}>
                              High: {rev.highCount}
                            </span>
                          )}
                        </div>
                      </div>

                      <div style={{ fontSize: "0.8rem", color: "var(--muted)", maxWidth: "300px", textAlign: "right" }}>
                        <div style={{ textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                          {rev.target}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Subtab 3: Identity & Deduplication */}
          {activeTab === "identity" && (
            <div
              style={{
                background: "var(--panel)",
                border: "1px solid var(--border)",
                borderRadius: "10px",
                padding: "1.5rem",
                display: "flex",
                flexDirection: "column",
                gap: "1rem",
              }}
            >
              <h3 style={{ margin: 0, fontSize: "1.1rem" }}>
                Repository Identity Architecture
              </h3>
              <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--muted)", lineHeight: 1.6 }}>
                In accordance with system specifications, project identity is strictly defined by the combination of
                <strong> gitHost</strong> + <strong>repositoryPath</strong>. This guarantees that projects hosted on
                different servers or namespaces never collide, while duplicate submissions of MRs or branches are
                automatically recognized and routed to this single Project entity.
              </p>

              <div
                className="identity-meta-grid"
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  padding: "1rem",
                  display: "grid",
                  gridTemplateColumns: "minmax(120px, 1fr) minmax(0, 2fr)",
                  gap: "0.75rem",
                  fontSize: "0.85rem",
                  fontFamily: "ui-monospace, monospace",
                  minWidth: 0,
                  maxWidth: "100%",
                }}
              >
                <div style={{ color: "var(--muted)" }}>Git Host:</div>
                <div className="break-url" style={{ color: "var(--text)", fontWeight: 600, wordBreak: "break-all", overflowWrap: "anywhere" }}>{projectDetails.project.gitHost}</div>

                <div style={{ color: "var(--muted)" }}>Repository Path:</div>
                <div className="break-url" style={{ color: "var(--text)", fontWeight: 600, wordBreak: "break-all", overflowWrap: "anywhere" }}>{projectDetails.project.repositoryPath}</div>

                <div style={{ color: "var(--muted)" }}>Namespace:</div>
                <div className="break-url" style={{ color: "var(--text)", wordBreak: "break-all", overflowWrap: "anywhere" }}>{projectDetails.project.namespace || "(root)"}</div>

                <div style={{ color: "var(--muted)" }}>Project Name:</div>
                <div style={{ color: "var(--text)", wordBreak: "break-word" }}>{projectDetails.project.name}</div>

                <div style={{ color: "var(--muted)" }}>Composite Identity Key:</div>
                <div className="break-url" style={{ color: "var(--accent)", wordBreak: "break-all", overflowWrap: "anywhere" }}>
                  {`${projectDetails.project.gitHost.toLowerCase()}/${projectDetails.project.repositoryPath.toLowerCase()}`}
                </div>

                <div style={{ color: "var(--muted)" }}>Canonical URL:</div>
                <div className="break-url" style={{ color: "var(--text)", wordBreak: "break-all", overflowWrap: "anywhere" }}>{projectDetails.project.repositoryUrl}</div>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  fontSize: "0.8rem",
                  color: "var(--low)",
                  background: "rgba(63, 185, 80, 0.1)",
                  padding: "0.6rem 0.8rem",
                  borderRadius: "6px",
                  border: "1px solid rgba(63, 185, 80, 0.2)",
                  flexWrap: "wrap",
                  minWidth: 0,
                }}
              >
                <CheckCircle2 size={16} style={{ flexShrink: 0 }} />
                <span>
                  Deduplication active: Any Merge Request submitted under <code className="break-url" style={{ wordBreak: "break-all", overflowWrap: "anywhere" }}>{projectDetails.project.gitHost}/{projectDetails.project.repositoryPath}</code> resolves to this project entity.
                </span>
              </div>
            </div>
          )}

          {/* Subtab 4: AI System Guidelines & Custom Instructions */}
          {activeTab === "instructions" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
              {/* Header Box */}
              <div
                style={{
                  background: "var(--panel)",
                  border: "1px solid var(--border)",
                  borderRadius: "10px",
                  padding: "1.5rem",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  flexWrap: "wrap",
                  gap: "1rem",
                }}
              >
                <div style={{ flex: "1 1 300px", minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
                    <div
                      style={{
                        background: "rgba(168, 85, 247, 0.15)",
                        color: "#c084fc",
                        padding: "0.4rem",
                        borderRadius: "8px",
                      }}
                    >
                      <BrainCircuit size={20} />
                    </div>
                    <h3 style={{ margin: 0, fontSize: "1.2rem", color: "var(--text)" }}>
                      AI System Instructions & Guidelines / دستورات سیستمی هوش مصنوعی
                    </h3>
                    {projectDetails.project.customInstructions ? (
                      <span
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          background: "rgba(34, 197, 94, 0.15)",
                          color: "var(--low)",
                          border: "1px solid rgba(34, 197, 94, 0.3)",
                          padding: "0.15rem 0.6rem",
                          borderRadius: "999px",
                        }}
                      >
                        ✓ Active in AI Reviews
                      </span>
                    ) : (
                      <span
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: 500,
                          background: "rgba(255, 255, 255, 0.05)",
                          color: "var(--muted)",
                          border: "1px solid var(--border)",
                          padding: "0.15rem 0.6rem",
                          borderRadius: "999px",
                        }}
                      >
                        Not Set (Default model prompts used)
                      </span>
                    )}
                  </div>
                  <p style={{ margin: "0.5rem 0 0", color: "var(--muted)", fontSize: "0.85rem", lineHeight: 1.5 }}>
                    توضیحات و دستورالعمل‌های اختصاصی این پروژه مستقیماً به عنوان کانتکست سیستمی به تمام ایجنت‌های هوش مصنوعی منتقل می‌شود. می‌توانید قوانین معماری، نام‌گذاری، زبان پیام‌ها و استانداردهای تیم خود را اینجا تعیین کنید.
                  </p>
                </div>

                <div>
                  {!isEditingGuidelines ? (
                    <button
                      type="button"
                      onClick={() => setIsEditingGuidelines(true)}
                      style={{
                        background: "var(--accent)",
                        color: "white",
                        border: "none",
                        borderRadius: "8px",
                        padding: "0.55rem 1rem",
                        fontSize: "0.85rem",
                        fontWeight: 600,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "0.4rem",
                      }}
                    >
                      <Pencil size={15} />
                      <span>Edit Guidelines & Details</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setIsEditingGuidelines(false);
                        setEditName(projectDetails.project.name || "");
                        setEditDescription(projectDetails.project.description || "");
                        setEditInstructions(projectDetails.project.customInstructions || "");
                      }}
                      style={{
                        background: "rgba(255, 255, 255, 0.05)",
                        border: "1px solid var(--border)",
                        color: "var(--muted)",
                        borderRadius: "8px",
                        padding: "0.55rem 1rem",
                        fontSize: "0.85rem",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "0.4rem",
                      }}
                    >
                      <X size={15} />
                      <span>Cancel</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Status alerts */}
              {guidelinesSuccess && (
                <div
                  style={{
                    background: "rgba(34, 197, 94, 0.12)",
                    border: "1px solid rgba(34, 197, 94, 0.3)",
                    color: "var(--low)",
                    padding: "0.75rem 1rem",
                    borderRadius: "8px",
                    fontSize: "0.85rem",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                  }}
                >
                  <CheckCircle2 size={16} />
                  <span>{guidelinesSuccess}</span>
                </div>
              )}
              {guidelinesError && (
                <div
                  style={{
                    background: "rgba(248, 81, 73, 0.12)",
                    border: "1px solid rgba(248, 81, 73, 0.3)",
                    color: "var(--critical)",
                    padding: "0.75rem 1rem",
                    borderRadius: "8px",
                    fontSize: "0.85rem",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                  }}
                >
                  <AlertTriangle size={16} />
                  <span>{guidelinesError}</span>
                </div>
              )}

              {/* Viewer or Editor */}
              {isEditingGuidelines ? (
                /* ----------------- Edit Form ----------------- */
                <div
                  style={{
                    background: "var(--panel)",
                    border: "1px solid var(--border)",
                    borderRadius: "10px",
                    padding: "1.5rem",
                    display: "flex",
                    flexDirection: "column",
                    gap: "1.25rem",
                  }}
                >
                  <div>
                    <label
                      style={{
                        display: "block",
                        fontSize: "0.85rem",
                        fontWeight: 600,
                        color: "var(--text)",
                        marginBottom: "0.4rem",
                      }}
                    >
                      Project Display Name
                    </label>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="e.g. Storefront PWA"
                      style={{
                        width: "100%",
                        padding: "0.65rem 0.85rem",
                        background: "var(--bg)",
                        border: "1px solid var(--border)",
                        borderRadius: "8px",
                        color: "var(--text)",
                        fontSize: "0.85rem",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>

                  <div>
                    <label
                      style={{
                        display: "block",
                        fontSize: "0.85rem",
                        fontWeight: 600,
                        color: "var(--text)",
                        marginBottom: "0.4rem",
                      }}
                    >
                      Project Description (Optional)
                    </label>
                    <input
                      type="text"
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      placeholder="Brief overview of the project's purpose or architecture..."
                      style={{
                        width: "100%",
                        padding: "0.65rem 0.85rem",
                        background: "var(--bg)",
                        border: "1px solid var(--border)",
                        borderRadius: "8px",
                        color: "var(--text)",
                        fontSize: "0.85rem",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>

                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem", flexWrap: "wrap", gap: "0.5rem" }}>
                      <label
                        style={{
                          fontSize: "0.85rem",
                          fontWeight: 600,
                          color: "var(--text)",
                        }}
                      >
                        AI System Instructions & Guidelines (توضیحات سیستمی به هوش مصنوعی)
                      </label>
                      <span style={{ fontSize: "0.75rem", color: "var(--muted)", fontFamily: "monospace" }}>
                        {editInstructions.length} characters ({editInstructions.split("\n").filter(Boolean).length} lines)
                      </span>
                    </div>

                    <textarea
                      rows={10}
                      value={editInstructions}
                      onChange={(e) => setEditInstructions(e.target.value)}
                      placeholder={`Enter custom rules, instructions, or architectural guidelines here...\n\nExample:\n- All UI texts must be in fluent Persian (Farsi).\n- Ensure strict TypeScript typing, no 'any' types allowed.\n- Database queries must never run inside for-loops.\n- Enforce Conventional Commits format (feat, fix, refactor).`}
                      style={{
                        width: "100%",
                        padding: "0.75rem 1rem",
                        background: "var(--bg)",
                        border: "1px solid var(--border)",
                        borderRadius: "8px",
                        color: "var(--text)",
                        fontSize: "0.85rem",
                        fontFamily: "ui-monospace, monospace",
                        lineHeight: 1.6,
                        boxSizing: "border-box",
                        resize: "vertical",
                      }}
                    />
                  </div>

                  {/* Quick guideline template chips */}
                  <div>
                    <span style={{ fontSize: "0.75rem", color: "var(--muted)", fontWeight: 600, display: "block", marginBottom: "0.4rem" }}>
                      Quick Templates (Click to append):
                    </span>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                      {[
                        {
                          label: "🌐 Persian / RTL Localization",
                          text: "\n- تمام پیام‌های خطا و متون نمایشی به کاربر (UI strings) باید به زبان فارسی روان نوشته شوند.\n- فونت وزیرمتن و ویژگی‌های راست‌چین (dir=\"rtl\") رعایت شوند.",
                        },
                        {
                          label: "🛡️ Strict Security & OWASP",
                          text: "\n- بررسی دقیق ریسک‌های OWASP Top 10 (جلوگیری از SQL Injection, XSS, CSRF).\n- هیچ‌گونه کلید یا توکن محرمانه (API Key/Secret) نباید در کد هاردکد شود.\n- بررسی اعتبارسنجی ورودی‌های کاربر (Input sanitization).",
                        },
                        {
                          label: "⚡ Clean Architecture & TypeScript",
                          text: "\n- رعایت Clean Architecture و تفکیک لایه‌های دامنه (Domain) و ارائه‌دهنده (Service/Infra).\n- استفاده از تایپ‌های دقیق TypeScript و ممنوعیت استفاده از 'any'.\n- بررسی اثرات جانبی و استفاده صحیح از وابستگی‌های هوک‌ها.",
                        },
                        {
                          label: "🌿 Branch & Commit Conventions",
                          text: "\n- نام‌گذاری برنچ‌ها بر اساس الگوی: feature/<ticket>-<slug> یا fix/<ticket>-<slug>.\n- پیام‌های کامیت طبق استاندارد Conventional Commits (feat:, fix:, chore:, refactor:).",
                        },
                      ].map((tpl) => (
                        <button
                          key={tpl.label}
                          type="button"
                          onClick={() => setEditInstructions((prev) => (prev ? `${prev.trim()}\n${tpl.text.trim()}` : tpl.text.trim()))}
                          style={{
                            background: "rgba(255, 255, 255, 0.04)",
                            border: "1px solid var(--border)",
                            color: "var(--text)",
                            borderRadius: "6px",
                            padding: "0.3rem 0.65rem",
                            fontSize: "0.75rem",
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                          }}
                        >
                          + {tpl.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={handleSaveGuidelines}
                      disabled={savingGuidelines}
                      className="run-btn"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.4rem",
                        padding: "0.6rem 1.25rem",
                        fontSize: "0.85rem",
                      }}
                    >
                      <Save size={16} />
                      <span>{savingGuidelines ? "Saving Guidelines..." : "Save System Instructions"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsEditingGuidelines(false)}
                      style={{
                        background: "transparent",
                        border: "1px solid var(--border)",
                        color: "var(--muted)",
                        borderRadius: "8px",
                        padding: "0.6rem 1rem",
                        fontSize: "0.85rem",
                        cursor: "pointer",
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                /* ----------------- View Mode ----------------- */
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  {projectDetails.project.customInstructions ? (
                    <div
                      style={{
                        background: "var(--panel)",
                        border: "1px solid var(--border)",
                        borderRadius: "10px",
                        padding: "1.5rem",
                        display: "flex",
                        flexDirection: "column",
                        gap: "1rem",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          <span style={{ fontSize: "0.8rem", color: "var(--muted)", fontWeight: 600, textTransform: "uppercase" }}>
                            Current Active Guidelines
                          </span>
                          <span style={{ fontSize: "0.75rem", color: "var(--accent)", fontFamily: "monospace" }}>
                            ({projectDetails.project.customInstructions.length} chars)
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setIsEditingGuidelines(true)}
                          style={{
                            background: "transparent",
                            border: "none",
                            color: "var(--accent)",
                            fontSize: "0.8rem",
                            cursor: "pointer",
                            padding: 0,
                            display: "flex",
                            alignItems: "center",
                            gap: "0.3rem",
                            fontWeight: 500,
                          }}
                        >
                          <Pencil size={13} />
                          <span>Edit</span>
                        </button>
                      </div>

                      <pre
                        style={{
                          margin: 0,
                          background: "var(--bg)",
                          border: "1px solid var(--border)",
                          borderRadius: "8px",
                          padding: "1rem",
                          fontFamily: "ui-monospace, monospace",
                          fontSize: "0.85rem",
                          color: "var(--text)",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          lineHeight: 1.6,
                        }}
                      >
                        {projectDetails.project.customInstructions}
                      </pre>

                      {/* Live Prompt Injection Preview */}
                      <div
                        style={{
                          background: "rgba(47, 129, 247, 0.05)",
                          border: "1px solid rgba(47, 129, 247, 0.2)",
                          borderRadius: "8px",
                          padding: "1rem",
                          display: "flex",
                          flexDirection: "column",
                          gap: "0.4rem",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", color: "var(--accent)", fontSize: "0.8rem", fontWeight: 600 }}>
                          <FileText size={15} />
                          <span>AI Context Injection Preview / نحوه ارسال به مدل هوش مصنوعی:</span>
                        </div>
                        <pre
                          style={{
                            margin: 0,
                            fontSize: "0.78rem",
                            fontFamily: "monospace",
                            color: "var(--muted)",
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-all",
                          }}
                        >
                          {`--- PROJECT-SPECIFIC SYSTEM INSTRUCTIONS & GUIDELINES (${projectDetails.project.name}) ---\n${projectDetails.project.customInstructions}\nIMPORTANT: The above project-specific instructions MUST be strictly respected and prioritized by all reviewers.`}
                        </pre>
                      </div>
                    </div>
                  ) : (
                    <div
                      style={{
                        background: "var(--panel)",
                        border: "1px dashed var(--border)",
                        borderRadius: "10px",
                        padding: "3rem 1.5rem",
                        textAlign: "center",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: "1rem",
                      }}
                    >
                      <BrainCircuit size={44} style={{ color: "var(--muted)", opacity: 0.6 }} />
                      <div>
                        <h4 style={{ margin: "0 0 0.3rem", fontSize: "1.1rem", color: "var(--text)" }}>
                          No Custom System Instructions Yet
                        </h4>
                        <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--muted)", maxWidth: "480px" }}>
                          Add project-specific rules, architectural patterns, coding guidelines, or localization requirements so the AI specialists review code exactly according to your standards.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsEditingGuidelines(true)}
                        className="run-btn"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.4rem",
                          fontSize: "0.85rem",
                          padding: "0.55rem 1.2rem",
                        }}
                      >
                        <Plus size={16} />
                        <span>Add Project AI Guidelines</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Subtab 5: Team Members & Access */}
          {activeTab === "members" && (
            <ProjectMembersTab
              projectId={projectDetails.project.id}
              userRole={projectDetails.userRole}
            />
          )}
        </div>
      ) : (
        /* ------------------ Projects List View ------------------ */
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          {/* Search bar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              padding: "0.6rem 1rem",
            }}
          >
            <Search size={18} style={{ color: "var(--muted)" }} />
            <input
              type="text"
              placeholder="Search projects by name, host, or repository path..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--text)",
                outline: "none",
                width: "100%",
                fontSize: "0.9rem",
              }}
            />
          </div>

          {loading ? (
            <div style={{ textAlign: "center", padding: "3rem", color: "var(--muted)" }}>
              Loading projects...
            </div>
          ) : filteredProjects.length === 0 ? (
            <div
              style={{
                background: "var(--panel)",
                border: "1px solid var(--border)",
                borderRadius: "12px",
                padding: "3.5rem 2rem",
                textAlign: "center",
              }}
            >
              <FolderGit2 size={48} style={{ margin: "0 auto 1rem", opacity: 0.5, color: "var(--muted)" }} />
              <h3 style={{ margin: "0 0 0.5rem", color: "var(--text)" }}>
                {searchQuery ? "No Projects Matching Search" : "No Projects in Registry"}
              </h3>
              <p
                style={{
                  color: "var(--muted)",
                  fontSize: "0.9rem",
                  maxWidth: "500px",
                  margin: "0 auto 1.5rem",
                  lineHeight: 1.5,
                }}
              >
                Projects are created automatically when you submit any GitLab Merge Request or GitHub Pull Request URL for review, or you can manually create one right now.
              </p>
              <div style={{ display: "flex", justifyContent: "center", gap: "1rem" }}>
                <button
                  className="run-btn"
                  onClick={handleOpenCreateModal}
                  style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}
                >
                  <Plus size={16} />
                  <span>Create Project Manually</span>
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {filteredProjects.map((project) => (
                <div
                  key={project.id}
                  className="project-card-row responsive-url-box"
                  style={{
                    background: "var(--panel)",
                    border: "1px solid var(--border)",
                    borderRadius: "10px",
                    padding: "1.25rem",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "1rem",
                    transition: "border-color 0.15s ease",
                    minWidth: 0,
                    maxWidth: "100%",
                  }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.borderColor = "var(--accent)")}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.borderColor = "var(--border)")}
                >
                  {/* Left Column: Project Name & Repo Info */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", minWidth: 0, flex: "1 1 240px", maxWidth: "100%" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", minWidth: 0 }}>
                      <span
                        style={{
                          fontWeight: 700,
                          fontSize: "1.1rem",
                          color: "var(--text)",
                          cursor: "pointer",
                          wordBreak: "break-word",
                        }}
                        onClick={() => setSelectedProjectId(project.id)}
                      >
                        {project.name}
                      </span>
                      <span
                        style={{
                          fontSize: "0.7rem",
                          padding: "0.15rem 0.5rem",
                          borderRadius: "4px",
                          background: "rgba(59, 130, 246, 0.12)",
                          color: "var(--accent)",
                          border: "1px solid rgba(59, 130, 246, 0.25)",
                          fontFamily: "ui-monospace, monospace",
                          wordBreak: "break-all",
                        }}
                      >
                        {project.gitHost}
                      </span>
                      {project.customInstructions && (
                        <span
                          style={{
                            fontSize: "0.7rem",
                            padding: "0.15rem 0.5rem",
                            borderRadius: "4px",
                            background: "rgba(168, 85, 247, 0.12)",
                            color: "#c084fc",
                            border: "1px solid rgba(168, 85, 247, 0.3)",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "0.25rem",
                            fontWeight: 600,
                          }}
                          title="Has custom AI system instructions & guidelines"
                        >
                          <BrainCircuit size={11} />
                          <span>AI Guidelines</span>
                        </span>
                      )}
                      {project.userRole && (
                        <span
                          style={{
                            fontSize: "0.7rem",
                            padding: "0.15rem 0.5rem",
                            borderRadius: "4px",
                            background: project.userRole === "OWNER" ? "rgba(234, 179, 8, 0.15)" : "rgba(59, 130, 246, 0.15)",
                            color: project.userRole === "OWNER" ? "#facc15" : "#60a5fa",
                            border: `1px solid ${project.userRole === "OWNER" ? "rgba(234, 179, 8, 0.3)" : "rgba(59, 130, 246, 0.3)"}`,
                            fontWeight: 600,
                          }}
                        >
                          {project.userRole}
                        </span>
                      )}
                    </div>

                    {project.description && (
                      <p style={{ margin: "0.1rem 0 0", color: "var(--muted)", fontSize: "0.82rem", wordBreak: "break-word" }}>
                        {project.description}
                      </p>
                    )}

                    <div
                      style={{
                        fontSize: "0.8rem",
                        color: "var(--muted)",
                        fontFamily: "ui-monospace, monospace",
                        display: "flex",
                        alignItems: "center",
                        gap: "0.4rem",
                        flexWrap: "wrap",
                        minWidth: 0,
                      }}
                    >
                      <span className="break-url" style={{ wordBreak: "break-all", overflowWrap: "anywhere", minWidth: 0 }}>
                        {project.repositoryPath}
                      </span>
                      <a
                        href={project.repositoryUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "var(--muted)", flexShrink: 0 }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink size={12} />
                      </a>
                    </div>

                    <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.2rem" }}>
                      Created: {new Date(project.createdAt).toLocaleDateString()}
                    </div>
                  </div>

                  {/* Middle Column: Stats */}
                  <div
                    className="project-stats-grid"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "1.5rem",
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ textAlign: "center", minWidth: "80px" }}>
                      <div style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--text)" }}>
                        {project.mergeRequestCount}
                      </div>
                      <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                        Merge Requests
                      </div>
                    </div>

                    <div style={{ textAlign: "center", minWidth: "80px" }}>
                      <div style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--text)" }}>
                        {project.reviewCount}
                      </div>
                      <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                        Reviews
                      </div>
                    </div>

                    <div style={{ textAlign: "center", minWidth: "90px" }}>
                      <div
                        style={{
                          fontSize: "1.2rem",
                          fontWeight: 700,
                          color:
                            project.averageScore !== undefined
                              ? project.averageScore >= 80
                                ? "var(--low)"
                                : project.averageScore >= 60
                                  ? "var(--medium)"
                                  : "var(--critical)"
                              : "var(--muted)",
                        }}
                      >
                        {project.averageScore !== undefined
                          ? `${project.averageScore}%`
                          : "—"}
                      </div>
                      <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                        Score
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Actions */}
                  <div className="project-actions-row" style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
                    <button
                      onClick={() => setSelectedProjectId(project.id)}
                      style={{
                        background: "rgba(255, 255, 255, 0.05)",
                        border: "1px solid var(--border)",
                        color: "var(--text)",
                        borderRadius: "6px",
                        padding: "0.45rem 0.85rem",
                        fontSize: "0.85rem",
                        cursor: "pointer",
                        fontWeight: 500,
                      }}
                    >
                      View Details
                    </button>

                    {onNavigateToReview && (
                      <button
                        onClick={() => onNavigateToReview(project.repositoryUrl)}
                        style={{
                          background: "rgba(59, 130, 246, 0.15)",
                          border: "1px solid rgba(59, 130, 246, 0.3)",
                          color: "var(--accent)",
                          borderRadius: "6px",
                          padding: "0.45rem 0.85rem",
                          fontSize: "0.85rem",
                          cursor: "pointer",
                          fontWeight: 500,
                          display: "flex",
                          alignItems: "center",
                          gap: "0.3rem",
                        }}
                      >
                        <span>Review</span>
                        <ArrowRight size={14} />
                      </button>
                    )}

                    <button
                      onClick={() => handleDelete(project.id, project.name)}
                      title="Delete Project"
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "var(--muted)",
                        cursor: "pointer",
                        padding: "0.4rem",
                        borderRadius: "6px",
                      }}
                      onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--critical)")}
                      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--muted)")}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ------------------ Create Project Modal ------------------ */}
      {isModalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.75)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "1rem",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsModalOpen(false);
          }}
        >
          <div
            style={{
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderRadius: "14px",
              width: "100%",
              maxWidth: "550px",
              padding: "1.75rem",
              boxShadow: "0 20px 40px rgba(0, 0, 0, 0.5)",
              display: "flex",
              flexDirection: "column",
              gap: "1.25rem",
            }}
          >
            <div>
              <h2 style={{ margin: "0 0 0.4rem", fontSize: "1.3rem" }}>
                Add New Project
              </h2>
              <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.85rem" }}>
                Register a Git repository into the platform. Project uniqueness is strictly governed by Git host and repository path.
              </p>
            </div>

            <form onSubmit={handleCreateSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    marginBottom: "0.4rem",
                    color: "var(--text)",
                  }}
                >
                  Repository URL *
                </label>
                <input
                  type="text"
                  placeholder="e.g. https://gitlab.company.com/frontend/storefront-pwa"
                  value={repoUrlInput}
                  onChange={(e) => setRepoUrlInput(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "0.65rem 0.85rem",
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                    color: "var(--text)",
                    fontSize: "0.85rem",
                    fontFamily: "ui-monospace, monospace",
                    boxSizing: "border-box",
                  }}
                  autoFocus
                />
                <span style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.3rem", display: "block" }}>
                  Accepts repository URLs, MR/PR URLs, or .git links across any GitLab/GitHub instance.
                </span>
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    marginBottom: "0.4rem",
                    color: "var(--text)",
                  }}
                >
                  Project Display Name (Optional)
                </label>
                <input
                  type="text"
                  placeholder={parsedModalRepo?.name || "e.g. storefront-pwa"}
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "0.65rem 0.85rem",
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                    color: "var(--text)",
                    fontSize: "0.85rem",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    marginBottom: "0.4rem",
                    color: "var(--text)",
                  }}
                >
                  Project Description (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Core storefront application for customer checkout"
                  value={descriptionInput}
                  onChange={(e) => setDescriptionInput(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "0.65rem 0.85rem",
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                    color: "var(--text)",
                    fontSize: "0.85rem",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
                  <label
                    style={{
                      fontSize: "0.85rem",
                      fontWeight: 600,
                      color: "var(--text)",
                    }}
                  >
                    AI System Instructions & Guidelines (Optional)
                  </label>
                  <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                    دستورات سیستمی هوش مصنوعی
                  </span>
                </div>
                <textarea
                  rows={4}
                  placeholder={`Custom instructions injected into AI context during review...\nExample: Enforce Persian UI texts; Check SQL query optimization; Require TypeScript interfaces.`}
                  value={instructionsInput}
                  onChange={(e) => setInstructionsInput(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "0.65rem 0.85rem",
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                    color: "var(--text)",
                    fontSize: "0.85rem",
                    fontFamily: "ui-monospace, monospace",
                    boxSizing: "border-box",
                    resize: "vertical",
                  }}
                />
                <span style={{ fontSize: "0.72rem", color: "var(--muted)", marginTop: "0.25rem", display: "block" }}>
                  These rules are automatically provided as high-priority system context to all AI specialist reviewers for this project.
                </span>
              </div>

              {/* Live Parser Box */}
              {parsedModalRepo && (
                <div
                  style={{
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                    padding: "0.85rem",
                    fontSize: "0.8rem",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.4rem",
                  }}
                >
                  <div style={{ fontWeight: 600, color: "var(--muted)", fontSize: "0.75rem", textTransform: "uppercase" }}>
                    Detected Repository Identity
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(90px, 110px) minmax(0, 1fr)", gap: "0.35rem", minWidth: 0, maxWidth: "100%" }}>
                    <span style={{ color: "var(--muted)", flexShrink: 0 }}>Git Host:</span>
                    <span className="break-url" style={{ color: "var(--accent)", fontFamily: "monospace", wordBreak: "break-all", overflowWrap: "anywhere", minWidth: 0 }}>{parsedModalRepo.gitHost}</span>

                    <span style={{ color: "var(--muted)", flexShrink: 0 }}>Repository Path:</span>
                    <span className="break-url" style={{ color: "var(--text)", fontFamily: "monospace", wordBreak: "break-all", overflowWrap: "anywhere", minWidth: 0 }}>{parsedModalRepo.repositoryPath}</span>

                    <span style={{ color: "var(--muted)", flexShrink: 0 }}>Namespace:</span>
                    <span className="break-url" style={{ color: "var(--text)", wordBreak: "break-all", overflowWrap: "anywhere", minWidth: 0 }}>{parsedModalRepo.namespace || "(root)"}</span>

                    <span style={{ color: "var(--muted)", flexShrink: 0 }}>Identity Key:</span>
                    <span className="break-url" style={{ color: "var(--muted)", fontFamily: "monospace", wordBreak: "break-all", overflowWrap: "anywhere", minWidth: 0 }}>{parsedModalRepo.identityKey}</span>
                  </div>
                </div>
              )}

              {/* Duplicate Project Warning */}
              {duplicateProject && (
                <div
                  style={{
                    background: "rgba(248, 81, 73, 0.1)",
                    border: "1px solid rgba(248, 81, 73, 0.3)",
                    color: "var(--critical)",
                    borderRadius: "8px",
                    padding: "0.75rem",
                    fontSize: "0.85rem",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "0.5rem",
                    minWidth: 0,
                    maxWidth: "100%",
                  }}
                >
                  <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: "0.1rem" }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <strong>Duplicate Repository Detected:</strong>
                    <div style={{ fontSize: "0.8rem", marginTop: "0.2rem" }}>
                      A project for repository <code className="break-url" style={{ wordBreak: "break-all", overflowWrap: "anywhere" }}>{duplicateProject.gitHost}/{duplicateProject.repositoryPath}</code> already exists with the name "{duplicateProject.name}". Duplicate projects are not allowed.
                    </div>
                  </div>
                </div>
              )}

              {createError && !duplicateProject && (
                <div
                  style={{
                    background: "rgba(248, 81, 73, 0.1)",
                    border: "1px solid rgba(248, 81, 73, 0.3)",
                    color: "var(--critical)",
                    borderRadius: "8px",
                    padding: "0.75rem",
                    fontSize: "0.85rem",
                  }}
                >
                  {createError}
                </div>
              )}

              {createSuccess && (
                <div
                  style={{
                    background: "rgba(63, 185, 80, 0.1)",
                    border: "1px solid rgba(63, 185, 80, 0.3)",
                    color: "var(--low)",
                    borderRadius: "8px",
                    padding: "0.75rem",
                    fontSize: "0.85rem",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.4rem",
                  }}
                >
                  <CheckCircle2 size={16} />
                  <span>{createSuccess}</span>
                </div>
              )}

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "0.75rem",
                  marginTop: "0.5rem",
                }}
              >
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  style={{
                    background: "transparent",
                    border: "1px solid var(--border)",
                    color: "var(--muted)",
                    padding: "0.5rem 1rem",
                    borderRadius: "8px",
                    cursor: "pointer",
                    fontSize: "0.85rem",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating || !parsedModalRepo || Boolean(duplicateProject)}
                  className="run-btn"
                  style={{
                    opacity: creating || !parsedModalRepo || Boolean(duplicateProject) ? 0.5 : 1,
                    cursor: creating || !parsedModalRepo || Boolean(duplicateProject) ? "not-allowed" : "pointer",
                    fontSize: "0.85rem",
                    padding: "0.5rem 1.25rem",
                  }}
                >
                  {creating ? "Creating..." : "Create Project"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
