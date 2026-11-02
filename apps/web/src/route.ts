/**
 * Minimal hash router: `#/<tab>[/<projectId>[/<projectSubTab>]]`.
 * Hash routing keeps deep links working without server-side fallbacks.
 */

export type ProjectSubTab =
  | "mrs"
  | "reviews"
  | "identity"
  | "instructions"
  | "members"
  | "index"
  | "scan";

const SUB_TABS: readonly ProjectSubTab[] = [
  "mrs",
  "reviews",
  "identity",
  "instructions",
  "members",
  "index",
  "scan",
];

const TABS = [
  "howitworks",
  "review",
  "projects",
  "users",
  "audit",
  "profile",
  "skills",
  "history",
  "settings",
];

export interface RouteState {
  tab: string;
  projectId: string | null;
  subTab: ProjectSubTab;
}

export function parseRoute(hash: string): RouteState {
  const [tab = "", projectId = "", sub = ""] = hash
    .replace(/^#\/?/, "")
    .split("/")
    .map(decodeURIComponent);
  return {
    tab: TABS.includes(tab) ? tab : "review",
    projectId: tab === "projects" && projectId ? projectId : null,
    subTab: (SUB_TABS as readonly string[]).includes(sub)
      ? (sub as ProjectSubTab)
      : "mrs",
  };
}

export function buildRoute(r: RouteState): string {
  let h = `#/${r.tab}`;
  if (r.tab === "projects" && r.projectId) {
    h += `/${encodeURIComponent(r.projectId)}`;
    if (r.subTab !== "mrs") h += `/${r.subTab}`;
  }
  return h;
}
