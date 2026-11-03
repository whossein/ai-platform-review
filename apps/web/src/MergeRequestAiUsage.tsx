import { useState } from "react";
import { Bot, RefreshCw } from "lucide-react";
import { estimateMergeRequestAiUsage, type ProjectMergeRequest } from "./api.js";

interface Props {
  mr: ProjectMergeRequest;
  canEstimate: boolean;
  getEnv: () => Record<string, string>;
  onUpdated: (mr: ProjectMergeRequest) => void;
}

const LEVEL_COLOR = { low: "var(--low)", medium: "var(--medium)", high: "var(--high)" } as const;

/**
 * Estimated chance the MR was written with AI (rules + AI judge). Runs only
 * when the reviewer clicks the button; independent of the review run.
 */
export function MergeRequestAiUsage({ mr, canEstimate, getEnv, onUpdated }: Props): JSX.Element | null {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const usage = mr.aiUsage;

  // Reviewers only: this is an estimate about a person's work, not for general viewers.
  if (!canEstimate) return null;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      onUpdated(await estimateMergeRequestAiUsage(mr.projectId, mr.id, getEnv()));
    } catch (e: any) {
      setError(e.message || "Estimate failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", fontSize: "0.8rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
        <Bot size={14} />
        {usage ? (
          <span>
            AI-written likelihood:{" "}
            <strong style={{ color: LEVEL_COLOR[usage.level] }}>
              {usage.percent}% ({usage.level})
            </strong>
          </span>
        ) : (
          <span style={{ color: "var(--muted)" }}>AI-written likelihood: not estimated yet</span>
        )}
        <button
          type="button"
          onClick={run}
          disabled={busy}
          style={{
            background: "transparent",
            border: "1px solid var(--border)",
            color: "var(--text)",
            borderRadius: "6px",
            padding: "0.2rem 0.55rem",
            cursor: busy ? "wait" : "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "0.3rem",
            fontSize: "0.8rem",
          }}
        >
          <RefreshCw size={12} className={busy ? "spin" : undefined} />
          {busy ? "Estimating…" : usage ? "Re-estimate AI usage" : "Estimate AI usage"}
        </button>
      </div>

      {usage && (
        <details style={{ color: "var(--muted)" }}>
          <summary style={{ cursor: "pointer" }}>
            Why? · {usage.method === "rules+ai" ? "rules + AI" : "rules only"} · {new Date(usage.computedAt).toLocaleString()}
          </summary>
          <ul style={{ margin: "0.3rem 0 0", paddingInlineStart: "1.2rem" }}>
            {usage.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
          <div style={{ marginTop: "0.3rem", fontStyle: "italic" }}>
            An estimate from style signals, not proof. Rules {usage.rulesScore}%
            {usage.aiScore !== undefined ? ` · AI ${usage.aiScore}%` : ""}.
          </div>
        </details>
      )}
      {error && <span style={{ color: "var(--critical)" }}>{error}</span>}
    </div>
  );
}
