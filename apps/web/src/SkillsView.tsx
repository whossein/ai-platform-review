import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle, Lock, RefreshCw, Wrench } from "lucide-react";
import {
  fetchProjectDetails,
  fetchProjects,
  fetchReviewCatalog,
  saveReviewConfig,
  type CatalogAgent,
  type CatalogRule,
  type Project,
  type ProjectWithStats,
  type ReviewCatalog,
} from "./api.js";

const SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"];

const panel: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: "10px",
  padding: "1.25rem 1.5rem",
};

const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.65rem 0.85rem",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: "8px",
  color: "var(--text)",
  fontSize: "0.85rem",
  boxSizing: "border-box",
};

const mutedText: React.CSSProperties = { color: "var(--muted)", fontSize: "0.82rem", lineHeight: 1.5 };

/** Project-wide switched-off rules that exist in the catalog (file-scoped ones are managed elsewhere). */
function projectWideOff(project: Project, catalog: ReviewCatalog): Set<string> {
  const known = new Set(catalog.rules.map((r) => r.id));
  return new Set(
    (project.suppressedRules ?? []).filter((s) => !s.file && known.has(s.ruleId)).map((s) => s.ruleId),
  );
}

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size === b.size && [...a].every((x) => b.has(x));

function Switch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (next: boolean) => void;
}): JSX.Element {
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.4rem",
        fontSize: "0.78rem",
        fontWeight: 600,
        color: checked ? "var(--low)" : "var(--muted)",
        cursor: disabled ? "default" : "pointer",
        flexShrink: 0,
      }}
    >
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: "var(--accent)", width: "16px", height: "16px", cursor: "inherit" }}
      />
      {checked ? "On" : "Off"}
    </label>
  );
}

function AgentCard({
  agent,
  enabled,
  instructions,
  maxLength,
  readOnly,
  onToggle,
  onInstructions,
}: {
  agent: CatalogAgent;
  enabled: boolean;
  instructions: string;
  maxLength: number;
  readOnly: boolean;
  onToggle: (next: boolean) => void;
  onInstructions: (text: string) => void;
}): JSX.Element {
  return (
    <div style={{ ...panel, padding: "1rem 1.25rem", opacity: enabled ? 1 : 0.75 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: "1rem", color: "var(--text)", flex: "1 1 220px" }}>{agent.name}</h3>
        {agent.locked && (
          <span
            title="Security checks always run"
            style={{ ...mutedText, display: "inline-flex", alignItems: "center", gap: "0.3rem" }}
          >
            <Lock size={13} /> Always on
          </span>
        )}
        <Switch
          checked={enabled}
          disabled={readOnly || agent.locked}
          label={`${agent.name} on or off`}
          onChange={onToggle}
        />
      </div>
      <p style={{ ...mutedText, margin: "0.4rem 0 0" }}>{agent.goal}</p>

      <details open={instructions.trim() !== ""} style={{ marginTop: "0.75rem" }}>
        <summary style={{ cursor: "pointer", fontSize: "0.82rem", color: "var(--accent)" }}>
          Checklist and extra instructions
        </summary>
        <div style={{ marginTop: "0.6rem", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          <div>
            <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text)" }}>
              Checklist (built in, read-only)
            </div>
            <p style={{ ...mutedText, margin: "0.2rem 0 0" }}>{agent.checklist}</p>
          </div>
          <div>
            <label
              htmlFor={`instr-${agent.id}`}
              style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text)" }}
            >
              Extra instructions for this specialist
            </label>
            <textarea
              id={`instr-${agent.id}`}
              rows={3}
              maxLength={maxLength}
              readOnly={readOnly}
              value={instructions}
              onChange={(e) => onInstructions(e.target.value)}
              placeholder={readOnly ? "None" : "e.g. Our API layer intentionally returns raw DB errors in dev builds."}
              style={{ ...fieldStyle, marginTop: "0.25rem", resize: "vertical", lineHeight: 1.5 }}
            />
            <div style={{ ...mutedText, fontSize: "0.72rem", textAlign: "right" }}>
              {instructions.length} / {maxLength}
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}

function RuleRow({
  rule,
  enabled,
  readOnly,
  onToggle,
}: {
  rule: CatalogRule;
  enabled: boolean;
  readOnly: boolean;
  onToggle: (next: boolean) => void;
}): JSX.Element {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "0.75rem",
        padding: "0.7rem 1rem",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <Switch
        checked={enabled}
        disabled={readOnly || rule.security}
        label={`${rule.id} on or off`}
        onChange={onToggle}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <code style={{ color: "var(--text)", fontSize: "0.82rem", wordBreak: "break-all" }}>{rule.id}</code>
          {rule.severity && <span className={`badge sev-${rule.severity}`}>{rule.severity}</span>}
          {rule.security && (
            <span style={{ ...mutedText, display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
              <Lock size={12} /> Locked
            </span>
          )}
        </div>
        <div style={{ ...mutedText, marginTop: "0.2rem" }}>{rule.description}</div>
        {rule.security && (
          <div style={{ ...mutedText, fontSize: "0.75rem", marginTop: "0.2rem" }}>
            Security rules always run project-wide. A false positive can only be silenced for one file, by
            rejecting the finding in a review.
          </div>
        )}
      </div>
    </div>
  );
}

export function SkillsView(): JSX.Element {
  const [catalog, setCatalog] = useState<ReviewCatalog | null>(null);
  const [projects, setProjects] = useState<ProjectWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [projectId, setProjectId] = useState("");
  const [project, setProject] = useState<Project | null>(null);
  const [role, setRole] = useState<string | undefined>(undefined);
  const [projectLoading, setProjectLoading] = useState(false);

  // Drafts: what the user sees on screen; saved separately per section.
  const [agentsOff, setAgentsOff] = useState<Set<string>>(new Set());
  const [instructions, setInstructions] = useState<Record<string, string>>({});
  const [rulesOff, setRulesOff] = useState<Set<string>>(new Set());
  const [ruleFilter, setRuleFilter] = useState("");

  const [saving, setSaving] = useState<"agents" | "rules" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const canManage = role === "OWNER" || role === "MANAGER";

  // Catalog and project list
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    Promise.all([fetchReviewCatalog(), fetchProjects()])
      .then(([cat, list]) => {
        if (cancelled) return;
        setCatalog(cat);
        setProjects(list);
        setProjectId((current) => current || list[0]?.id || "");
      })
      .catch((err: any) => {
        if (!cancelled) setLoadError(err.message || "Failed to load Skills & Rules.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // The selected project's saved settings
  useEffect(() => {
    if (!projectId || !catalog) return;
    let cancelled = false;
    setProjectLoading(true);
    setError(null);
    setSuccess(null);
    fetchProjectDetails(projectId)
      .then((details) => {
        if (cancelled) return;
        setProject(details.project);
        setRole(details.userRole);
        setAgentsOff(new Set(details.project.disabledAgents ?? []));
        setInstructions({ ...(details.project.agentInstructions ?? {}) });
        setRulesOff(projectWideOff(details.project, catalog));
      })
      .catch((err: any) => {
        if (cancelled) return;
        setProject(null);
        setError(err.message || "Failed to load the project.");
      })
      .finally(() => {
        if (!cancelled) setProjectLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, catalog]);

  const savedInstructions = project?.agentInstructions ?? {};
  const agentsDirty =
    project !== null &&
    (!sameSet(agentsOff, new Set(project.disabledAgents ?? [])) ||
      (catalog?.agents ?? []).some(
        (a) => (instructions[a.id] ?? "").trim() !== (savedInstructions[a.id] ?? ""),
      ));
  const rulesDirty =
    project !== null && catalog !== null && !sameSet(rulesOff, projectWideOff(project, catalog));
  const dirty = agentsDirty || rulesDirty;

  const selectProject = (id: string) => {
    if (dirty && !window.confirm("Discard your unsaved changes?")) return;
    setProject(null);
    setRole(undefined);
    setProjectId(id);
  };

  const flashSuccess = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 4000);
  };

  const save = async (section: "agents" | "rules") => {
    if (!catalog || !project) return;
    try {
      setSaving(section);
      setError(null);
      setSuccess(null);
      const updated = await saveReviewConfig(
        project.id,
        section === "agents"
          ? {
              disabledAgents: [...agentsOff],
              agentInstructions: Object.fromEntries(
                Object.entries(instructions)
                  .map(([id, text]) => [id, text.trim()] as const)
                  .filter(([, text]) => text !== ""),
              ),
            }
          : { disabledRules: [...rulesOff] },
      );
      setProject(updated);
      if (section === "agents") {
        setAgentsOff(new Set(updated.disabledAgents ?? []));
        setInstructions({ ...(updated.agentInstructions ?? {}) });
      } else {
        setRulesOff(projectWideOff(updated, catalog));
      }
      flashSuccess(section === "agents" ? "Specialist settings saved." : "Rule settings saved.");
    } catch (err: any) {
      setError(err.message || "Failed to save.");
    } finally {
      setSaving(null);
    }
  };

  const visibleRules = useMemo(() => {
    const q = ruleFilter.trim().toLowerCase();
    return (catalog?.rules ?? [])
      .filter((r) => !q || r.id.toLowerCase().includes(q) || r.description.toLowerCase().includes(q))
      .sort(
        (a, b) =>
          SEVERITY_ORDER.indexOf(a.severity ?? "info") - SEVERITY_ORDER.indexOf(b.severity ?? "info") ||
          a.id.localeCompare(b.id),
      );
  }, [catalog, ruleFilter]);

  const fileScopedCount = (project?.suppressedRules ?? []).filter((s) => s.file).length;
  const agents = catalog?.agents ?? [];
  const maxLength = catalog?.limits.maxAgentInstructionLength ?? 2000;

  return (
    <div className="skills-view" style={{ maxWidth: "1100px", margin: "0 auto" }}>
      <header style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.6rem", fontWeight: 700, display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <Wrench size={22} /> Skills & Rules / مهارت‌ها و قوانین
        </h1>
        <p style={{ ...mutedText, margin: "0.25rem 0 0", fontSize: "0.9rem" }}>
          Choose which AI specialists and deterministic rules run for a project, and give each specialist extra
          instructions. Settings apply to every review of that project.
        </p>
      </header>

      {loadError && (
        <div className="auth-error-banner" style={{ marginBottom: "1rem" }}>
          <AlertCircle size={16} />
          <span style={{ flex: 1 }}>{loadError}</span>
          <button className="secondary-button" onClick={() => setReloadKey((k) => k + 1)}>
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      )}

      {loading && !loadError && <p style={mutedText}>Loading skills and rules...</p>}

      {!loading && !loadError && projects.length === 0 && (
        <div style={panel}>
          <p style={{ ...mutedText, margin: 0 }}>
            There are no projects yet. Projects are created in the Projects tab or when you review a merge request
            link; their settings then appear here.
          </p>
        </div>
      )}

      {catalog && projects.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <div style={{ ...panel, display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
            <label htmlFor="skills-project" style={{ fontWeight: 600, fontSize: "0.9rem" }}>
              Project / پروژه
            </label>
            <select
              id="skills-project"
              value={projectId}
              onChange={(e) => selectProject(e.target.value)}
              style={{ ...fieldStyle, width: "auto", minWidth: "260px", flex: "1 1 260px" }}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {project && !canManage && (
              <span style={mutedText}>
                Read-only: only project owners and managers can change these settings.
              </span>
            )}
          </div>

          {error && (
            <div className="auth-error-banner">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}
          {success && (
            <div
              style={{
                background: "rgba(16, 185, 129, 0.15)",
                border: "1px solid rgba(16, 185, 129, 0.4)",
                color: "#34d399",
                padding: "0.75rem 1rem",
                borderRadius: "8px",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                fontSize: "0.875rem",
              }}
            >
              <CheckCircle size={16} />
              <span>{success}</span>
            </div>
          )}

          {projectLoading && <p style={mutedText}>Loading project settings...</p>}

          {project && !projectLoading && (
            <>
              <section key={`agents-${project.id}`} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 360px" }}>
                    <h2 style={{ margin: 0, fontSize: "1.2rem" }}>
                      AI specialists / ایجنت‌های هوش مصنوعی{" "}
                      <span style={{ ...mutedText, fontWeight: 400 }}>
                        ({agents.length - agentsOff.size} of {agents.length} on)
                      </span>
                    </h2>
                    <p style={{ ...mutedText, margin: "0.25rem 0 0" }}>
                      For each review the planner still picks the specialists that fit the changed files; switching
                      one off removes it from every review of this project, and switching it on does not force it to
                      run. Extra instructions are sent only to that specialist, next to the project guidelines, and
                      cannot change the output format or safety rules. Guideline sections tagged for a switched-off
                      specialist go to the Code Reviewer if it runs.
                    </p>
                  </div>
                  {canManage && (
                    <button onClick={() => save("agents")} disabled={!agentsDirty || saving !== null}>
                      {saving === "agents" ? "Saving..." : "Save specialists"}
                    </button>
                  )}
                </div>
                {agents.map((agent) => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    enabled={!agentsOff.has(agent.id)}
                    instructions={instructions[agent.id] ?? ""}
                    maxLength={maxLength}
                    readOnly={!canManage}
                    onToggle={(on) =>
                      setAgentsOff((prev) => {
                        const next = new Set(prev);
                        if (on) next.delete(agent.id);
                        else next.add(agent.id);
                        return next;
                      })
                    }
                    onInstructions={(text) => setInstructions((prev) => ({ ...prev, [agent.id]: text }))}
                  />
                ))}
              </section>

              <section key={`rules-${project.id}`} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 360px" }}>
                    <h2 style={{ margin: 0, fontSize: "1.2rem" }}>
                      Deterministic rules / قوانین ثابت{" "}
                      <span style={{ ...mutedText, fontWeight: 400 }}>
                        ({catalog.rules.length - rulesOff.size} of {catalog.rules.length} on)
                      </span>
                    </h2>
                    <p style={{ ...mutedText, margin: "0.25rem 0 0" }}>
                      These pattern checks run before the AI, at no token cost. A switched-off rule is skipped in
                      reviews and repository scans of this project; the AI specialists may still point out the same
                      problem.
                      {fileScopedCount > 0 &&
                        ` ${fileScopedCount} more ${fileScopedCount === 1 ? "rule is" : "rules are"} silenced for single files; see the project's Guidelines tab.`}
                    </p>
                  </div>
                  {canManage && (
                    <button onClick={() => save("rules")} disabled={!rulesDirty || saving !== null}>
                      {saving === "rules" ? "Saving..." : "Save rules"}
                    </button>
                  )}
                </div>
                <input
                  type="search"
                  aria-label="Filter rules"
                  placeholder="Filter rules by name or description"
                  value={ruleFilter}
                  onChange={(e) => setRuleFilter(e.target.value)}
                  style={fieldStyle}
                />
                <div style={{ ...panel, padding: 0, overflow: "hidden" }}>
                  {visibleRules.length === 0 ? (
                    <p style={{ ...mutedText, padding: "1rem", margin: 0 }}>No rule matches the filter.</p>
                  ) : (
                    visibleRules.map((rule) => (
                      <RuleRow
                        key={rule.id}
                        rule={rule}
                        enabled={!rulesOff.has(rule.id)}
                        readOnly={!canManage}
                        onToggle={(on) =>
                          setRulesOff((prev) => {
                            const next = new Set(prev);
                            if (on) next.delete(rule.id);
                            else next.add(rule.id);
                            return next;
                          })
                        }
                      />
                    ))
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      )}
    </div>
  );
}
