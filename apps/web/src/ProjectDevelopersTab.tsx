import { useMemo, useState } from "react";
import { UserRound, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import type { ProjectMergeRequest } from "./api.js";

interface Props {
  mergeRequests: ProjectMergeRequest[];
  onNavigateToReview?: ((url: string) => void) | undefined;
}

interface DevRow {
  key: string;
  username: string;
  name?: string | undefined;
  avatarUrl?: string | undefined;
  profileUrl?: string | undefined;
  mrs: ProjectMergeRequest[];
  avgGrade?: number | undefined;
  avgSuggested?: number | undefined;
  gradedCount: number;
}

const avg = (xs: number[]): number | undefined =>
  xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : undefined;

const scoreColor = (n: number): string =>
  n >= 8 ? "var(--low)" : n >= 6 ? "var(--medium)" : "var(--critical)";

/** Developers (MR authors) of a project with their MR counts and grades. */
export function ProjectDevelopersTab({ mergeRequests, onNavigateToReview }: Props): JSX.Element {
  const [open, setOpen] = useState<string | null>(null);

  const { rows, unknownCount } = useMemo(() => {
    const map = new Map<string, DevRow>();
    let unknown = 0;
    for (const mr of mergeRequests) {
      if (!mr.author) {
        unknown++;
        continue;
      }
      const key = mr.author.username.toLowerCase();
      const row = map.get(key) ?? {
        key,
        username: mr.author.username,
        name: mr.author.name,
        avatarUrl: mr.author.avatarUrl,
        profileUrl: mr.author.profileUrl,
        mrs: [],
        gradedCount: 0,
      };
      row.mrs.push(mr);
      map.set(key, row);
    }
    const list = [...map.values()].map((r) => ({
      ...r,
      gradedCount: r.mrs.filter((m) => m.grade).length,
      avgGrade: avg(r.mrs.flatMap((m) => (m.grade ? [m.grade.score] : []))),
      avgSuggested: avg(r.mrs.flatMap((m) => (m.suggestedGrade ? [m.suggestedGrade.score] : []))),
    }));
    list.sort((a, b) => b.mrs.length - a.mrs.length);
    return { rows: list, unknownCount: unknown };
  }, [mergeRequests]);

  const card: React.CSSProperties = {
    background: "var(--panel)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
  };

  if (rows.length === 0) {
    return (
      <div style={{ ...card, padding: "3rem", textAlign: "center", color: "var(--muted)" }}>
        <UserRound size={40} style={{ margin: "0 auto 1rem", opacity: 0.5 }} />
        <h3 style={{ margin: "0 0 0.5rem", color: "var(--text)" }}>No Developers Yet · هنوز توسعه‌دهنده‌ای ثبت نشده</h3>
        <p style={{ margin: 0, fontSize: "0.9rem", maxWidth: 460, marginInline: "auto" }}>
          Authors appear here after an MR/PR of this repository is reviewed (a Git token is needed for private repos).
          {unknownCount > 0 ? ` ${unknownCount} MR(s) have no author yet.` : ""}
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {rows.map((r) => {
        const expanded = open === r.key;
        return (
          <div key={r.key} style={card}>
            <button
              type="button"
              onClick={() => setOpen(expanded ? null : r.key)}
              aria-expanded={expanded}
              style={{
                width: "100%",
                background: "transparent",
                border: "none",
                color: "var(--text)",
                cursor: "pointer",
                padding: "0.9rem 1rem",
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                flexWrap: "wrap",
                textAlign: "left",
              }}
            >
              {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              {r.avatarUrl ? (
                <img src={r.avatarUrl} alt="" width={28} height={28} style={{ borderRadius: "50%" }} />
              ) : (
                <UserRound size={22} />
              )}
              <div style={{ flex: "1 1 160px", minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{r.name || r.username}</div>
                {r.name && <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>@{r.username}</div>}
              </div>
              <Stat label="MRs" value={String(r.mrs.length)} />
              <Stat label="Graded" value={`${r.gradedCount}/${r.mrs.length}`} />
              <Stat label="Avg grade" value={r.avgGrade ?? "—"} color={r.avgGrade !== undefined ? scoreColor(r.avgGrade) : undefined} />
              <Stat label="Avg suggested" value={r.avgSuggested ?? "—"} color={r.avgSuggested !== undefined ? scoreColor(r.avgSuggested) : undefined} />
            </button>

            {expanded && (
              <div style={{ borderTop: "1px solid var(--border)", padding: "0.5rem 1rem 0.9rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {r.profileUrl && (
                  <a href={r.profileUrl} target="_blank" rel="noreferrer" style={{ fontSize: "0.8rem", color: "var(--accent)" }}>
                    Git profile <ExternalLink size={11} />
                  </a>
                )}
                {r.mrs.map((mr) => (
                  <div key={mr.id} style={{ display: "flex", gap: "0.75rem", alignItems: "baseline", flexWrap: "wrap", fontSize: "0.85rem" }}>
                    <a href={mr.url} target="_blank" rel="noreferrer" style={{ color: "var(--text)", fontWeight: 600 }}>
                      MR #{mr.mrNumber}
                    </a>
                    <span style={{ color: "var(--muted)", flex: "1 1 200px", minWidth: 0 }}>{mr.title ?? ""}</span>
                    <span style={{ color: mr.grade ? scoreColor(mr.grade.score) : "var(--muted)" }}>
                      {mr.grade ? `Grade ${mr.grade.score}` : "Not graded"}
                    </span>
                    {mr.suggestedGrade && (
                      <span style={{ color: "var(--muted)" }} title={mr.suggestedGrade.reason}>
                        Suggested {mr.suggestedGrade.score}
                      </span>
                    )}
                    {onNavigateToReview && (
                      <button
                        type="button"
                        onClick={() => onNavigateToReview(mr.url)}
                        style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: "0.8rem" }}
                      >
                        Review MR
                      </button>
                    )}
                    {(mr.grade || mr.suggestedGrade) && (
                      <div style={{ flexBasis: "100%", fontSize: "0.8rem", color: "var(--muted)", display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                        {mr.grade && (
                          <span>
                            Graded by {mr.grade.gradedByName}
                            {mr.grade.note ? <>: <em style={{ color: "var(--text)" }}>“{mr.grade.note}”</em></> : " (no note)"}
                          </span>
                        )}
                        {mr.suggestedGrade && <span>Suggestion reason: {mr.suggestedGrade.reason}</span>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {unknownCount > 0 && (
        <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
          {unknownCount} MR(s) without a known author are not listed.
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string | number; color?: string | undefined }): JSX.Element {
  return (
    <div style={{ textAlign: "center", minWidth: "4.5rem" }}>
      <div style={{ fontWeight: 700, color: color ?? "var(--text)" }}>{value}</div>
      <div style={{ fontSize: "0.7rem", color: "var(--muted)" }}>{label}</div>
    </div>
  );
}
