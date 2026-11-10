import { useState } from "react";
import { Sparkles, Pencil, Check, X } from "lucide-react";
import { gradeMergeRequest, type ProjectMergeRequest } from "./api.js";

const GRADE_ROLES = new Set(["OWNER", "MANAGER", "REVIEWER"]);

export function canGradeMergeRequests(userRole?: string | undefined): boolean {
  return userRole !== undefined && GRADE_ROLES.has(userRole);
}

function scoreColor(score: number): string {
  return score >= 8 ? "var(--low)" : score >= 6 ? "var(--medium)" : "var(--critical)";
}

interface Props {
  mr: ProjectMergeRequest;
  canGrade: boolean;
  onUpdated: (mr: ProjectMergeRequest) => void;
}

/** Reviewer's task-completion grade for an MR, plus the system's suggestion. */
export function MergeRequestGrade({ mr, canGrade, onUpdated }: Props): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [score, setScore] = useState<string>("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEdit = (initial?: number) => {
    setScore(String(initial ?? mr.grade?.score ?? mr.suggestedGrade?.score ?? ""));
    setNote(mr.grade?.note ?? "");
    setError(null);
    setEditing(true);
  };

  const save = async (value: number | null) => {
    setSaving(true);
    setError(null);
    try {
      onUpdated(await gradeMergeRequest(mr.projectId, mr.id, value, note));
      setEditing(false);
    } catch (e: any) {
      setError(e.message || "Failed to save grade");
    } finally {
      setSaving(false);
    }
  };

  const parsed = Number(score);
  const valid = score.trim() !== "" && Number.isInteger(parsed) && parsed >= 0 && parsed <= 10;
  const suggestion = mr.suggestedGrade;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.8rem", minWidth: 0 }}>
      {mr.grade ? (
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <span
            title={`Graded by ${mr.grade.gradedByName} on ${new Date(mr.grade.gradedAt).toLocaleString()}`}
            style={{ fontWeight: 700, color: scoreColor(mr.grade.score), background: "var(--panel-2, rgba(255,255,255,0.05))", padding: "0.15rem 0.5rem", borderRadius: "4px" }}
          >
            Grade: {mr.grade.score}/10
          </span>
          <span style={{ color: "var(--muted)" }}>by {mr.grade.gradedByName}</span>
          {canGrade && !editing && (
            <button type="button" onClick={() => startEdit()} aria-label="Edit grade" style={iconBtn}>
              <Pencil size={13} />
            </button>
          )}
        </div>
      ) : (
        !editing && <span style={{ color: "var(--muted)" }}>Not graded yet</span>
      )}

      {mr.grade?.note && !editing && (
        <span style={{ color: "var(--muted)", fontStyle: "italic" }}>“{mr.grade.note}”</span>
      )}

      {suggestion && !editing && (
        <div
          title={suggestion.reason}
          style={{ display: "flex", alignItems: "center", gap: "0.4rem", color: "var(--muted)", flexWrap: "wrap" }}
        >
          <Sparkles size={12} />
          <span>
            Suggested <strong style={{ color: scoreColor(suggestion.score) }}>{suggestion.score}</strong> — {suggestion.reason}
          </span>
          {canGrade && !mr.grade && (
            <button type="button" onClick={() => startEdit(suggestion.score)} style={linkBtn}>
              Use
            </button>
          )}
        </div>
      )}

      {canGrade && !mr.grade && !editing && (
        <button type="button" onClick={() => startEdit()} style={linkBtn}>
          Grade this MR
        </button>
      )}

      {editing && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="number"
              min={0}
              max={10}
              value={score}
              onChange={(e) => setScore(e.target.value)}
              placeholder="0-10"
              aria-label="Task completion grade (0-10)"
              style={{ width: "5rem", padding: "0.25rem 0.4rem", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)" }}
            />
            <input
              type="text"
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Short note (optional)"
              aria-label="Grade note"
              style={{ flex: "1 1 160px", padding: "0.25rem 0.4rem", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)" }}
            />
            <button type="button" disabled={!valid || saving} onClick={() => save(parsed)} aria-label="Save grade" style={iconBtn}>
              <Check size={14} />
            </button>
            <button type="button" disabled={saving} onClick={() => setEditing(false)} aria-label="Cancel" style={iconBtn}>
              <X size={14} />
            </button>
            {mr.grade && (
              <button type="button" disabled={saving} onClick={() => save(null)} style={linkBtn}>
                Remove grade
              </button>
            )}
          </div>
          {error && <span style={{ color: "var(--critical)" }}>{error}</span>}
        </div>
      )}
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--border)",
  color: "var(--text)",
  borderRadius: "6px",
  padding: "0.2rem 0.4rem",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
};

const linkBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "var(--accent)",
  cursor: "pointer",
  padding: 0,
  fontSize: "0.8rem",
  textAlign: "left",
};
