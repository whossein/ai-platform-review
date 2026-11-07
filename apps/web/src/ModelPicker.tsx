import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";

export interface ModelInfo {
  id: string;
  name?: string;
  inputCostPer1M?: number;
  outputCostPer1M?: number;
  contextLength?: number;
}

export interface ModelListState {
  loading: boolean;
  models: ModelInfo[];
  error?: string;
}

const MAX_VISIBLE = 200;

function fmtPrice(n: number): string {
  return n === 0 ? "free" : `$${n < 0.01 ? n.toPrecision(2) : +n.toFixed(3)}`;
}

function fmtContext(n: number): string {
  return n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}K`;
}

interface Props {
  label: string;
  value: string;
  placeholder?: string;
  list?: ModelListState;
  onFetch: () => void;
  /** Called with the typed/selected id; info is set only when picked from the list. */
  onChange: (id: string, info?: ModelInfo) => void;
}

/** Searchable model combobox: shows price/context from the provider and reports the picked model. */
export function ModelPicker({ label, value, placeholder, list, onFetch, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const models = list?.models ?? [];

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    const exact = models.some((m) => m.id.toLowerCase() === q);
    // When the field already holds a full id, show everything instead of a single row.
    const hits = !q || exact ? models : models.filter((m) => `${m.id} ${m.name ?? ""}`.toLowerCase().includes(q));
    return hits.slice(0, MAX_VISIBLE);
  }, [models, value]);

  const pick = (m: ModelInfo) => {
    onChange(m.id, m);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp") && models.length) {
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && filtered[active]) {
      e.preventDefault();
      pick(filtered[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const loaded = models.length > 0;
  const priced = models.filter((m) => m.inputCostPer1M !== undefined || m.outputCostPer1M !== undefined).length;

  return (
    <div className="form-group" style={{ flex: 1, marginBottom: 0 }} ref={rootRef}>
      <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>{label}</span>
        <button
          type="button"
          onClick={onFetch}
          disabled={list?.loading}
          style={{
            background: "transparent",
            border: "none",
            color: "var(--accent)",
            cursor: "pointer",
            fontSize: "0.8rem",
            padding: 0,
            display: "inline-flex",
            alignItems: "center",
            gap: "0.25rem",
          }}
        >
          <RefreshCw size={12} className={list?.loading ? "spin" : undefined} />
          {list?.loading ? "Loading..." : loaded ? `Refresh (${models.length})` : "Fetch List"}
        </button>
      </label>
      <div style={{ position: "relative" }}>
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          onChange={(e) => {
            onChange(e.target.value);
            setActive(0);
            if (loaded) setOpen(true);
          }}
          onFocus={() => loaded && setOpen(true)}
          onKeyDown={onKeyDown}
          style={loaded ? { paddingRight: "2rem" } : undefined}
        />
        {loaded && (
          <ChevronDown
            size={16}
            onClick={() => setOpen((o) => !o)}
            style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", cursor: "pointer", color: "var(--muted)" }}
          />
        )}
        {open && loaded && (
          <div
            role="listbox"
            style={{
              position: "absolute",
              zIndex: 50,
              top: "calc(100% + 4px)",
              left: 0,
              right: 0,
              maxHeight: 280,
              overflowY: "auto",
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
            }}
          >
            {filtered.length === 0 && (
              <div style={{ padding: "0.6rem", color: "var(--muted)", fontSize: "0.8rem" }}>
                No match — the typed name will be used as-is.
              </div>
            )}
            {filtered.map((m, i) => (
              <div
                key={m.id}
                role="option"
                aria-selected={m.id === value}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(m);
                }}
                onMouseEnter={() => setActive(i)}
                style={{
                  padding: "0.45rem 0.6rem",
                  cursor: "pointer",
                  background: i === active ? "rgba(127,127,127,0.18)" : "transparent",
                  borderLeft: m.id === value ? "2px solid var(--accent)" : "2px solid transparent",
                }}
              >
                <div style={{ fontSize: "0.85rem", wordBreak: "break-all" }}>{m.id}</div>
                {(m.name || m.inputCostPer1M !== undefined || m.outputCostPer1M !== undefined || m.contextLength) && (
                  <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", fontSize: "0.72rem", color: "var(--muted)" }}>
                    {m.name && <span>{m.name}</span>}
                    {(m.inputCostPer1M !== undefined || m.outputCostPer1M !== undefined) && (
                      <span>
                        {m.inputCostPer1M !== undefined ? fmtPrice(m.inputCostPer1M) : "?"} in /{" "}
                        {m.outputCostPer1M !== undefined ? fmtPrice(m.outputCostPer1M) : "?"} out per 1M
                      </span>
                    )}
                    {m.contextLength ? <span>{fmtContext(m.contextLength)} ctx</span> : null}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {list?.error && (
        <div style={{ color: "var(--error)", fontSize: "0.8rem", marginTop: "0.25rem" }}>{list.error}</div>
      )}
      {loaded && !list?.error && (
        <div style={{ color: "var(--muted)", fontSize: "0.72rem", marginTop: "0.25rem" }}>
          {priced > 0
            ? `${priced} of ${models.length} models report pricing; picking one fills the cost fields.`
            : "This provider does not report pricing — enter costs manually."}
        </div>
      )}
    </div>
  );
}
