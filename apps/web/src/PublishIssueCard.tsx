import { useState } from "react";
import {
  requestCommitSuggestion,
  requestFeedback,
  requestSuggestCode,
  type AiCodeSuggestion,
  type CodeSnippet,
  type ReviewIssue,
} from "./api.js";

export interface IssuePrep {
  selected: boolean;
  editedReason: string;
  editedSuggestion?: string;
}

const SEVERITY_EMOJI: Record<string, string> = {
  critical: "🔴",
  high: "🟠",
  medium: "🟡",
  low: "🔵",
  info: "⚪",
};

const WINDOW = 6;

const FEEDBACK_REASONS = [
  { value: "false_positive", label: "False positive — the code is fine", rule: "reviewers found it to be a false positive" },
  { value: "our_standard", label: "Intentional — this is our project standard", rule: "this is an intentional project convention" },
  { value: "style", label: "Style preference, not a real issue", rule: "style preference, not a defect" },
  { value: "not_relevant", label: "Not relevant to this change", rule: "not relevant to the changed code" },
  { value: "other", label: "Other", rule: "" },
];

/** Cuts a few lines around `line` out of a unified diff (new-file numbering). */
export function snippetFromDiff(
  diff: string,
  file: string,
  line?: number,
): CodeSnippet | undefined {
  const rows: { n: number; text: string }[] = [];
  let inFile = false;
  let n = 0;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("+++ ")) {
      inFile = raw.slice(4).replace(/^b\//, "").trim() === file;
      continue;
    }
    if (!inFile) continue;
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(raw);
    if (hunk) {
      n = Number(hunk[1]);
      continue;
    }
    if (raw.startsWith("-") || raw.startsWith("\\")) continue;
    if (raw.startsWith("+") || raw.startsWith(" ")) {
      rows.push({ n, text: raw.slice(1) });
      n++;
    }
  }
  if (rows.length === 0) return undefined;
  const target = line ?? rows[0]!.n;
  const near = rows.filter((r) => Math.abs(r.n - target) <= WINDOW);
  if (near.length === 0) return undefined;
  return { startLine: near[0]!.n, lines: near.map((r) => r.text) };
}

function CodeBlock({
  lines,
  startLine,
  highlight,
}: {
  lines: readonly string[];
  startLine: number;
  highlight?: (n: number) => "flag" | "del" | "add" | undefined;
}): JSX.Element {
  return (
    <pre
      dir="ltr"
      style={{
        margin: 0,
        background: "#0b0f14",
        border: "1px solid var(--border)",
        borderRadius: 6,
        padding: "0.5rem 0",
        fontSize: "0.8rem",
        lineHeight: 1.5,
        overflowX: "auto",
        textAlign: "left",
      }}
    >
      {lines.map((text, i) => {
        const n = startLine + i;
        const kind = highlight?.(n);
        const bg =
          kind === "flag"
            ? "rgba(248,81,73,0.18)"
            : kind === "add"
              ? "rgba(63,185,80,0.15)"
              : kind === "del"
                ? "rgba(248,81,73,0.15)"
                : "transparent";
        return (
          <div key={i} style={{ display: "flex", background: bg }}>
            <span
              style={{
                minWidth: 44,
                padding: "0 0.6rem",
                textAlign: "right",
                color: "var(--muted)",
                userSelect: "none",
                borderRight: "1px solid var(--border)",
                marginRight: "0.6rem",
              }}
            >
              {n}
            </span>
            <code style={{ whiteSpace: "pre", color: "var(--text)" }}>
              {text || " "}
            </code>
          </div>
        );
      })}
    </pre>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div
      style={{
        fontSize: "0.72rem",
        fontWeight: 700,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: "var(--muted)",
        margin: "0.9rem 0 0.35rem",
      }}
    >
      {children}
    </div>
  );
}

const chip: React.CSSProperties = {
  fontSize: "0.72rem",
  background: "var(--surface, #1c2128)",
  padding: "0.1rem 0.5rem",
  borderRadius: 999,
  border: "1px solid var(--border)",
};

const field: React.CSSProperties = {
  width: "100%",
  background: "var(--surface, #1c2128)",
  border: "1px solid var(--border)",
  color: "var(--text)",
  padding: "0.65rem 0.75rem",
  borderRadius: 6,
  fontFamily: "inherit",
  resize: "vertical",
  textAlign: "start",
  boxSizing: "border-box",
};

const smallBtn: React.CSSProperties = {
  padding: "0.4rem 0.8rem",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text)",
  cursor: "pointer",
  fontSize: "0.82rem",
  fontWeight: 600,
};

export interface PublishIssueCardProps {
  issue: ReviewIssue;
  prep: IssuePrep;
  onChange: (patch: Partial<IssuePrep>) => void;
  /** Language the PR comment is written in; "fa" flips text blocks to RTL. */
  language: "en" | "fa";
  /** MR URL when the review came from a Merge Request; enables AI + commit. */
  prUrl?: string | undefined;
  snippet?: CodeSnippet | undefined;
  /** Why the code could not be loaded (shown when there is no snippet). */
  snippetError?: string | undefined;
  /** Link to this file/line on the Git host. */
  fileUrl?: string | undefined;
  /** Project this review belongs to; feedback needs it. */
  projectId?: string | undefined;
  /** Called with the project's new instructions after a rule was added. */
  onRulesUpdated?: ((customInstructions: string) => void) | undefined;
  getEnv: () => Record<string, string>;
}

export function PublishIssueCard({
  issue,
  prep,
  onChange,
  language,
  prUrl,
  snippet,
  snippetError,
  fileUrl,
  projectId,
  onRulesUpdated,
  getEnv,
}: PublishIssueCardProps): JSX.Element {
  const dir = language === "fa" ? "rtl" : "ltr";
  const [ai, setAi] = useState<AiCodeSuggestion | null>(null);
  const [aiCode, setAiCode] = useState("");
  const [busy, setBusy] = useState<"gen" | "commit" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [addedBlock, setAddedBlock] = useState<string | null>(null);
  const [committed, setCommitted] = useState<{ webUrl?: string; branch: string } | null>(null);

  const [fbOpen, setFbOpen] = useState(false);
  const [fbReason, setFbReason] = useState("false_positive");
  const [fbNote, setFbNote] = useState("");
  const [fbAddRule, setFbAddRule] = useState(false);
  const [fbRule, setFbRule] = useState("");
  const [fbDone, setFbDone] = useState<string | null>(null);
  const [fbBusy, setFbBusy] = useState(false);

  const loc = issue.location;

  function defaultRule(reason: string, note: string): string {
    const why = FEEDBACK_REASONS.find((r) => r.value === reason)?.rule ?? "";
    return `Do not report "${issue.title}" (${issue.category}) in this project${why ? `: ${why}` : ""}${note.trim() ? ` — ${note.trim()}` : ""}.`;
  }

  async function sendFeedback(verdict: "up" | "down"): Promise<void> {
    if (!projectId) return;
    setFbBusy(true);
    setErr(null);
    try {
      const r = await requestFeedback(projectId, {
        verdict,
        issue,
        ...(verdict === "down"
          ? {
              reason: fbReason,
              note: fbNote,
              addToRules: fbAddRule,
              rule: fbRule || defaultRule(fbReason, fbNote),
            }
          : { reason: "useful" }),
      });
      if (r.ruleAdded && r.project?.customInstructions !== undefined) {
        onRulesUpdated?.(r.project.customInstructions);
      }
      setFbDone(
        verdict === "up"
          ? "Thanks — marked as useful."
          : r.ruleAdded
            ? issue.producedBy === "agent.rule-engine"
              ? "Saved. This rule is now silenced; re-enable it from the project page."
              : "Saved, and added to the project rules."
            : (r.ruleDenied ?? "Feedback saved."),
      );
      setFbOpen(false);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setFbBusy(false);
    }
  }
  const flaggedLine = loc.line;

  async function generate(): Promise<void> {
    if (!prUrl) return;
    setBusy("gen");
    setErr(null);
    setCommitted(null);
    try {
      const s = await requestSuggestCode(prUrl, issue, getEnv());
      setAi(s);
      setAiCode(s.code);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(aiCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setErr("Copy failed — select the code and copy it manually.");
    }
  }

  /** Builds a Git "suggestion" block so the host offers an Apply button. */
  function buildSuggestionBlock(): string {
    if (!ai) return "";
    const above = flaggedLine ? flaggedLine - ai.startLine : 0;
    const below = flaggedLine ? ai.endLine - flaggedLine : 0;
    const anchored = flaggedLine !== undefined && above >= 0 && below >= 0;
    const tag = !anchored || (above === 0 && below === 0) ? "suggestion" : `suggestion:-${above}+${below}`;
    const body = aiCode.replace(/\n+$/, "");
    return "```" + tag + "\n" + body + "\n```";
  }

  function toggleInComment(): void {
    const current = prep.editedSuggestion ?? "";
    if (addedBlock !== null) {
      onChange({ editedSuggestion: current.replace(addedBlock, "").replace(/\n{3,}/g, "\n\n").trim() });
      setAddedBlock(null);
      return;
    }
    const block = buildSuggestionBlock();
    onChange({ editedSuggestion: current.trim() ? `${current.trim()}\n\n${block}` : block });
    setAddedBlock(block);
  }

  async function commit(): Promise<void> {
    if (!prUrl || !ai) return;
    const target = `${ai.file}:${ai.startLine}-${ai.endLine}`;
    if (
      !window.confirm(
        `Commit this change to branch "${ai.sourceBranch}"?\n\n${target}\n\nThis creates a real commit on the merge request's source branch.`,
      )
    )
      return;
    setBusy("commit");
    setErr(null);
    try {
      const r = await requestCommitSuggestion(prUrl, { ...ai, code: aiCode }, getEnv());
      setCommitted({ branch: r.branch, ...(r.webUrl ? { webUrl: r.webUrl } : {}) });
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  const commentPreview = [
    `${SEVERITY_EMOJI[issue.severity] ?? ""} **${issue.severity.toUpperCase()}: ${issue.title}**`,
    "",
    issue.description,
    "",
    `_Why:_ ${prep.editedReason}`,
    ...(issue.suggestion || prep.editedSuggestion
      ? ["", `_Suggestion:_ ${prep.editedSuggestion ?? ""}`]
      : []),
    "",
    `${issue.category} · confidence ${(issue.confidence * 100).toFixed(0)}%`,
  ].join("\n");

  return (
    <div
      style={{
        background: "var(--panel)",
        border: `1px solid ${prep.selected ? "var(--accent)" : "var(--border)"}`,
        borderRadius: 10,
        padding: "1rem 1.1rem",
        opacity: prep.selected ? 1 : 0.6,
        transition: "all 0.2s",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: "0.9rem" }}>
        <input
          type="checkbox"
          checked={prep.selected}
          onChange={(e) => onChange({ selected: e.target.checked })}
          style={{ marginTop: "0.3rem", width: 18, height: 18, cursor: "pointer" }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, color: "var(--text)" }} dir="auto">
              {SEVERITY_EMOJI[issue.severity]} {issue.title}
            </span>
          </div>
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginTop: "0.4rem" }}>
            <span style={{ ...chip, color: `var(--${issue.severity})`, fontWeight: 600 }}>
              {issue.severity}
            </span>
            <span style={chip}>{issue.category}</span>
            <span style={chip}>{(issue.confidence * 100).toFixed(0)}% confidence</span>
            <span style={{ ...chip, fontFamily: "monospace" }} dir="ltr">
              {loc.file}
              {flaggedLine ? `:${flaggedLine}` : ""}
            </span>
            {fileUrl && (
              <a
                href={fileUrl}
                target="_blank"
                rel="noreferrer"
                style={{ ...chip, color: "var(--accent)", textDecoration: "none" }}
              >
                Open in Git ↗
              </a>
            )}
          </div>

          {/* Flagged code */}
          {snippet ? (
            <>
              <SectionLabel>Code</SectionLabel>
              <CodeBlock
                lines={snippet.lines}
                startLine={snippet.startLine}
                highlight={(n) => (n === flaggedLine ? "flag" : undefined)}
              />
            </>
          ) : snippetError ? (
            <div
              dir="ltr"
              style={{ marginTop: "0.8rem", fontSize: "0.8rem", color: "var(--muted)" }}
            >
              Code preview unavailable: {snippetError}
            </div>
          ) : null}

          {/* Fields that go into the PR comment */}
          <div dir={dir} style={{ textAlign: "start" }}>
            {issue.description && (
              <>
                <SectionLabel>Description</SectionLabel>
                <div style={{ fontSize: "0.9rem", lineHeight: 1.7, color: "var(--text)" }}>
                  {issue.description}
                </div>
              </>
            )}

            <SectionLabel>Reason (Why)</SectionLabel>
            <textarea
              dir="auto"
              value={prep.editedReason}
              onChange={(e) => onChange({ editedReason: e.target.value })}
              style={{ ...field, minHeight: 72 }}
            />

            {(issue.suggestion || prep.editedSuggestion) && (
              <>
                <SectionLabel>Suggestion</SectionLabel>
                <textarea
                  dir="auto"
                  value={prep.editedSuggestion ?? ""}
                  onChange={(e) => onChange({ editedSuggestion: e.target.value })}
                  style={{ ...field, minHeight: 56 }}
                />
              </>
            )}
          </div>

          {issue.suggestion?.patch && (
            <>
              <SectionLabel>Suggested patch</SectionLabel>
              <CodeBlock
                lines={issue.suggestion.patch.split("\n")}
                startLine={1}
                highlight={() => undefined}
              />
            </>
          )}

          {/* AI sample code */}
          <SectionLabel>AI sample fix</SectionLabel>
          {!ai ? (
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
              <button
                onClick={generate}
                disabled={!prUrl || busy !== null}
                style={{
                  ...smallBtn,
                  background: prUrl ? "var(--accent)" : "transparent",
                  color: prUrl ? "white" : "var(--muted)",
                  borderColor: prUrl ? "var(--accent)" : "var(--border)",
                  cursor: !prUrl || busy ? "not-allowed" : "pointer",
                }}
              >
                {busy === "gen" ? "Asking AI…" : "✨ Get AI sample fix"}
              </button>
              {!prUrl && (
                <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                  Needs a Merge Request URL.
                </span>
              )}
            </div>
          ) : (
            <div>
              <div
                dir={dir}
                style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.5rem", textAlign: "start" }}
              >
                {ai.explanation}
              </div>
              <div dir="ltr" style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: "0.3rem" }}>
                Replaces {ai.file}:{ai.startLine}
                {ai.endLine > ai.startLine ? `-${ai.endLine}` : ""} on <b>{ai.sourceBranch}</b>
              </div>
              <textarea
                dir="ltr"
                value={aiCode}
                onChange={(e) => setAiCode(e.target.value)}
                spellCheck={false}
                style={{
                  ...field,
                  fontFamily: "monospace",
                  fontSize: "0.82rem",
                  minHeight: 110,
                  whiteSpace: "pre",
                  textAlign: "left",
                }}
              />
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.5rem", alignItems: "center" }}>
                <button onClick={copy} style={smallBtn}>
                  {copied ? "✓ Copied" : "Copy"}
                </button>
                <button onClick={generate} disabled={busy !== null} style={smallBtn}>
                  {busy === "gen" ? "Asking AI…" : "Regenerate"}
                </button>
                <button
                  onClick={toggleInComment}
                  disabled={busy !== null || !aiCode.trim()}
                  style={smallBtn}
                  title="Appends the code to this issue's PR comment as a Git suggestion block"
                >
                  {addedBlock !== null ? "✓ Added to comment (undo)" : "Add to comment"}
                </button>
                <button
                  onClick={commit}
                  disabled={busy !== null || committed !== null}
                  style={{ ...smallBtn, borderColor: "var(--accent)", color: "var(--accent)" }}
                >
                  {busy === "commit" ? "Committing…" : "Commit to branch"}
                </button>
                {committed && (
                  <span style={{ fontSize: "0.82rem", color: "var(--low)", fontWeight: 600 }}>
                    ✓ Committed to {committed.branch}
                    {committed.webUrl && (
                      <>
                        {" "}
                        <a href={committed.webUrl} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                          view
                        </a>
                      </>
                    )}
                  </span>
                )}
              </div>
            </div>
          )}
          {err && (
            <div style={{ marginTop: "0.5rem", fontSize: "0.82rem", color: "var(--critical)" }}>{err}</div>
          )}

          {/* Feedback */}
          <SectionLabel>Feedback</SectionLabel>
          {!projectId ? (
            <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
              Feedback needs a project — review from a Merge Request URL.
            </div>
          ) : fbDone ? (
            <div style={{ fontSize: "0.85rem", color: "var(--low)", fontWeight: 600 }}>✓ {fbDone}</div>
          ) : (
            <div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button onClick={() => sendFeedback("up")} disabled={fbBusy} style={smallBtn}>
                  👍 Useful
                </button>
                <button
                  onClick={() => {
                    setFbOpen((o) => !o);
                    setFbRule(defaultRule(fbReason, fbNote));
                  }}
                  disabled={fbBusy}
                  style={smallBtn}
                >
                  👎 Not useful
                </button>
              </div>
              {fbOpen && (
                <div
                  style={{
                    marginTop: "0.6rem",
                    padding: "0.75rem",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.6rem",
                  }}
                >
                  <select
                    value={fbReason}
                    onChange={(e) => {
                      setFbReason(e.target.value);
                      setFbRule(defaultRule(e.target.value, fbNote));
                    }}
                    style={{ ...field, resize: "none" }}
                  >
                    {FEEDBACK_REASONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <textarea
                    dir="auto"
                    placeholder="Optional note…"
                    value={fbNote}
                    onChange={(e) => {
                      setFbNote(e.target.value);
                      setFbRule(defaultRule(fbReason, e.target.value));
                    }}
                    style={{ ...field, minHeight: 48 }}
                  />
                  <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", fontSize: "0.85rem", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={fbAddRule}
                      onChange={(e) => setFbAddRule(e.target.checked)}
                    />
                    Add to project rules (the AI follows them in every review)
                  </label>
                  {fbAddRule && (
                    <textarea
                      dir="auto"
                      value={fbRule}
                      onChange={(e) => setFbRule(e.target.value)}
                      style={{ ...field, minHeight: 56 }}
                    />
                  )}
                  <div>
                    <button
                      onClick={() => sendFeedback("down")}
                      disabled={fbBusy}
                      style={{ ...smallBtn, background: "var(--accent)", color: "white", borderColor: "var(--accent)" }}
                    >
                      {fbBusy ? "Saving…" : "Send feedback"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Exact PR comment preview */}
          <details style={{ marginTop: "0.9rem" }}>
            <summary style={{ cursor: "pointer", fontSize: "0.8rem", color: "var(--muted)" }}>
              Preview of the comment that will be posted
            </summary>
            <pre
              dir={dir}
              style={{
                whiteSpace: "pre-wrap",
                background: "var(--surface, #1c2128)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "0.75rem",
                fontSize: "0.82rem",
                textAlign: "start",
                marginTop: "0.5rem",
              }}
            >
              {commentPreview}
            </pre>
          </details>
        </div>
      </div>
    </div>
  );
}
