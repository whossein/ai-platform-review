/**
 * Typed client for the @ai-review/api server. The Web and Desktop UIs share this
 * module so both speak to the exact same review pipeline. All calls go through
 * the `/api` prefix, which Vite proxies to the API server in dev (see
 * vite.config.ts) and which a reverse proxy handles in production.
 */

import type {
  SafeUser,
  SafeSession,
  UserRole,
  UserStatus,
  ProjectRole,
  ProjectMemberWithUser,
  GitCredentialProvider,
  GitCredentialSummary,
  AuditLogEntry,
  AuditAction,
} from "@ai-review/core";

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export interface ReviewIssue {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly severity: Severity;
  readonly confidence: number;
  readonly reason: string;
  readonly suggestion?: {
    readonly description: string;
    readonly patch?: string;
  };
  readonly location: { readonly file: string; readonly line?: number };
  readonly category: string;
  readonly accepted: boolean;
  readonly rankScore: number;
}

export interface ReviewResponse {
  readonly markdown: string;
  readonly json: unknown;
  readonly accepted: number;
  readonly total: number;
  readonly issues: readonly ReviewIssue[];
  readonly metrics?: {
    readonly totalPromptTokens: number;
    readonly totalCompletionTokens: number;
    readonly totalCostUsd: number;
  };
  readonly project?: Project | undefined;
  readonly mergeRequest?: ProjectMergeRequest | undefined;
}

export interface EstimateResponse {
  readonly agents: readonly string[];
  readonly skipped: readonly string[];
  readonly totalAgents: number;
  readonly estimatedTokens: number;
  readonly estimatedInputTokens?: number;
  readonly estimatedOutputTokens?: number;
  readonly inputCostPer1M?: number;
  readonly outputCostPer1M?: number;
  readonly estimatedCostUsd: number;
  readonly deterministicIssues?: readonly ReviewIssue[];
}

// ==========================================
// AUTHENTICATION TOKEN STORAGE & WRAPPER
// ==========================================

const TOKEN_KEY = "ai_review_session_token";

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    // Ignore storage issues in private modes
  }
}

export async function authFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const token = getStoredToken();
  const headers = new Headers(init?.headers || {});

  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(input, { ...init, headers });

  if (response.status === 401) {
    // If unauthorized, notify listeners
    window.dispatchEvent(new CustomEvent("ai-review-auth-unauthorized"));
  }

  return response;
}

// ==========================================
// CORE REVIEW PIPELINE CLIENT
// ==========================================

export async function requestEstimate(
  diff: string,
  env?: Record<string, string>,
): Promise<EstimateResponse> {
  const res = await authFetch("/api/estimate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ diff, ...(env ? { env } : {}) }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `estimate failed (${res.status})`);
  }
  return (await res.json()) as EstimateResponse;
}

export async function requestReview(
  diff: string,
  threshold?: number,
  env?: Record<string, string>,
  selectedSpecialists?: readonly string[],
  signal?: AbortSignal,
  projectId?: string,
  mergeRequestId?: string,
  customInstructions?: string,
  projectName?: string,
): Promise<ReviewResponse> {
  const reqInit: RequestInit = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      diff,
      ...(threshold !== undefined ? { threshold } : {}),
      ...(env ? { env } : {}),
      ...(selectedSpecialists ? { selectedSpecialists } : {}),
      ...(projectId ? { projectId } : {}),
      ...(mergeRequestId ? { mergeRequestId } : {}),
      ...(customInstructions ? { customInstructions } : {}),
      ...(projectName ? { projectName } : {}),
    }),
  };
  if (signal) {
    reqInit.signal = signal;
  }

  const res = await authFetch("/api/review", reqInit);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `review failed (${res.status})`);
  }
  return (await res.json()) as ReviewResponse;
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch("/api/health");
    return res.ok;
  } catch {
    return false;
  }
}

export async function requestPublish(
  diff: string,
  issues: readonly ReviewIssue[],
  env?: Record<string, string>,
): Promise<unknown> {
  const res = await authFetch("/api/publish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ diff, issues, ...(env ? { env } : {}) }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `publish failed (${res.status})`);
  }
  return await res.json();
}

export async function requestApplyLocal(
  localPath: string,
  issues: readonly ReviewIssue[],
): Promise<unknown> {
  const res = await authFetch("/api/apply-local", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ localPath, issues }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `apply-local failed (${res.status})`);
  }
  return await res.json();
}

export interface TestProviderResult {
  ok: boolean;
  latencyMs?: number | undefined;
  model?: string | undefined;
  error?: string | undefined;
}

export async function requestTestProvider(
  params:
    | string
    | {
        provider: string;
        apiKey?: string | undefined;
        model?: string | undefined;
        baseUrl?: string | undefined;
        customAuthHeaderName?: string | undefined;
        customAuthHeaderPrefix?: string | undefined;
        env?: Record<string, string> | undefined;
      },
  env?: Record<string, string>,
): Promise<TestProviderResult> {
  const body =
    typeof params === "string"
      ? { provider: params, ...(env ? { env } : {}) }
      : {
          provider: params.provider,
          apiKey: params.apiKey,
          model: params.model,
          baseUrl: params.baseUrl,
          customAuthHeaderName: params.customAuthHeaderName,
          customAuthHeaderPrefix: params.customAuthHeaderPrefix,
          ...(params.env || env ? { env: { ...(params.env || {}), ...(env || {}) } } : {}),
        };
  const res = await authFetch("/api/test-provider", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return await res.json();
}

export async function requestTestGitConnection(params: {
  type: "gitlab" | "github";
  baseUrl?: string;
  token: string;
}): Promise<{ ok: boolean; username?: string; latencyMs?: number; error?: string }> {
  const res = await authFetch("/api/test-git-connection", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => null);
  if (!data) {
    return {
      ok: false,
      error:
        res.status === 404
          ? "Endpoint not found (404) — restart the API server to load the latest version."
          : `Unexpected server response (HTTP ${res.status})`,
    };
  }
  return data;
}

export async function requestFetchModels(
  provider: string,
  apiKey?: string,
  baseUrl?: string,
): Promise<{ ok: boolean; models?: string[]; error?: string }> {
  const res = await authFetch("/api/models", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider, apiKey, baseUrl }),
  });
  return await res.json();
}

// ==========================================
// PROJECT REGISTRY CONTRACTS & API
// ==========================================

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly repositoryUrl: string;
  readonly gitHost: string;
  readonly repositoryPath: string;
  readonly namespace: string;
  readonly description?: string | undefined;
  readonly customInstructions?: string | undefined;
  readonly userRole?: string | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProjectMergeRequest {
  readonly id: string;
  readonly projectId: string;
  readonly mrNumber: string;
  readonly url: string;
  readonly title?: string | undefined;
  readonly sourceBranch?: string | undefined;
  readonly targetBranch?: string | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProjectReviewRecord {
  readonly id: string;
  readonly projectId: string;
  readonly mergeRequestId?: string | undefined;
  readonly timestamp: number;
  readonly inputMode: string;
  readonly target: string;
  readonly model: string;
  readonly score?: number | undefined;
  readonly issuesCount: number;
  readonly acceptedCount: number;
  readonly criticalCount: number;
  readonly highCount: number;
  readonly summaryMarkdown?: string | undefined;
}

export interface ProjectWithStats extends Project {
  readonly mergeRequestCount: number;
  readonly reviewCount: number;
  readonly latestReview?: ProjectReviewRecord | undefined;
  readonly averageScore?: number | undefined;
}

export interface ProjectDetailsResponse {
  readonly project: Project;
  readonly mergeRequests: ProjectMergeRequest[];
  readonly reviews: ProjectReviewRecord[];
  readonly stats: {
    readonly mergeRequestCount: number;
    readonly reviewCount: number;
    readonly averageScore?: number | undefined;
    readonly latestReview?: ProjectReviewRecord | undefined;
  };
  readonly userRole?: string | undefined;
}

export async function fetchProjects(): Promise<ProjectWithStats[]> {
  const res = await authFetch("/api/projects");
  if (!res.ok) {
    throw new Error(`Failed to fetch projects (${res.status})`);
  }
  const data = await res.json();
  return data.projects || [];
}

export async function fetchProjectDetails(
  id: string,
): Promise<ProjectDetailsResponse> {
  const res = await authFetch(`/api/projects/${encodeURIComponent(id)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Project not found (${res.status})`);
  }
  return await res.json();
}

export async function createProject(params: {
  name?: string | undefined;
  repositoryUrl: string;
  description?: string | undefined;
  customInstructions?: string | undefined;
}): Promise<Project> {
  const res = await authFetch("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err: any = new Error(data.error || `Failed to create project (${res.status})`);
    err.code = data.code;
    err.existingProject = data.existingProject;
    throw err;
  }
  return data.project;
}

export async function updateProject(
  id: string,
  params: {
    name?: string | undefined;
    description?: string | undefined;
    customInstructions?: string | undefined;
  },
): Promise<Project> {
  const res = await authFetch(`/api/projects/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Failed to update project (${res.status})`);
  }
  return data.project;
}

export async function findOrCreateProjectFromUrl(
  url: string,
  name?: string,
): Promise<{
  project: Project;
  mergeRequest?: ProjectMergeRequest;
  created: boolean;
}> {
  const res = await authFetch("/api/projects/find-or-create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, ...(name ? { name } : {}) }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Failed to resolve project from URL (${res.status})`);
  }
  return await res.json();
}

export async function deleteProject(id: string): Promise<boolean> {
  const res = await authFetch(`/api/projects/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Failed to delete project (${res.status})`);
  }
  return true;
}

// ==========================================
// AUTHENTICATION & ACCESS CONTROL API
// ==========================================

export interface AuthStatusResponse {
  initialized: boolean;
  authenticated: boolean;
  user: SafeUser | null;
}

export async function checkAuthStatus(): Promise<AuthStatusResponse> {
  const res = await authFetch("/api/auth/status");
  if (!res.ok) {
    return { initialized: true, authenticated: false, user: null };
  }
  return await res.json();
}

export async function setupFirstAdmin(params: {
  name: string;
  email: string;
  password: string;
  passwordConfirmation: string;
}): Promise<{ user: SafeUser; token: string }> {
  const res = await fetch("/api/auth/setup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `First-run setup failed (${res.status})`);
  }
  setStoredToken(data.token);
  return data;
}

export async function login(
  loginStr: string,
  passwordStr: string
): Promise<{ user: SafeUser; token: string }> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: loginStr, password: passwordStr }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Login failed (${res.status})`);
  }
  setStoredToken(data.token);
  return data;
}

export async function logout(): Promise<void> {
  try {
    await authFetch("/api/auth/logout", { method: "POST" });
  } finally {
    setStoredToken(null);
  }
}

export async function fetchCurrentUser(): Promise<SafeUser> {
  const res = await authFetch("/api/auth/me");
  if (!res.ok) {
    throw new Error("Failed to load user profile");
  }
  const data = await res.json();
  return data.user;
}

export async function updateProfile(updates: {
  name?: string;
  email?: string;
  avatar?: string;
}): Promise<SafeUser> {
  const res = await authFetch("/api/auth/me", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(updates),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Failed to update profile");
  }
  return data.user;
}

export async function changePassword(params: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<void> {
  const res = await authFetch("/api/auth/change-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Failed to change password");
  }
}

export async function fetchSessions(): Promise<SafeSession[]> {
  const res = await authFetch("/api/auth/sessions");
  if (!res.ok) {
    throw new Error("Failed to load sessions");
  }
  const data = await res.json();
  return data.sessions || [];
}

export async function revokeSession(sessionId: string): Promise<void> {
  const res = await authFetch(`/api/auth/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    throw new Error("Failed to revoke session");
  }
}

// ==========================================
// USER MANAGEMENT (ADMIN)
// ==========================================

export async function fetchUsers(): Promise<SafeUser[]> {
  const res = await authFetch("/api/users");
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to load users");
  }
  const data = await res.json();
  return data.users || [];
}

export async function createUser(params: {
  name: string;
  email: string;
  password: string;
  role?: UserRole;
  status?: UserStatus;
}): Promise<SafeUser> {
  const res = await authFetch("/api/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Failed to create user");
  }
  return data.user;
}

export async function updateUser(
  id: string,
  params: { name?: string; email?: string }
): Promise<SafeUser> {
  const res = await authFetch(`/api/users/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Failed to update user");
  }
  return data.user;
}

export async function setUserStatus(id: string, status: UserStatus): Promise<SafeUser> {
  const res = await authFetch(`/api/users/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Failed to update user status");
  }
  return data.user;
}

export async function setUserRole(id: string, role: UserRole): Promise<SafeUser> {
  const res = await authFetch(`/api/users/${encodeURIComponent(id)}/role`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Failed to update user role");
  }
  return data.user;
}

export async function resetUserPassword(id: string, newPassword: string): Promise<void> {
  const res = await authFetch(`/api/users/${encodeURIComponent(id)}/reset-password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ newPassword }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Failed to reset password");
  }
}

export async function deleteUser(id: string): Promise<void> {
  const res = await authFetch(`/api/users/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Failed to delete user");
  }
}

// ==========================================
// GIT CREDENTIALS (USER)
// ==========================================

export async function fetchGitCredentials(): Promise<GitCredentialSummary[]> {
  const res = await authFetch("/api/me/git-credentials");
  if (!res.ok) {
    throw new Error("Failed to load git credentials");
  }
  const data = await res.json();
  return data.credentials || [];
}

export async function saveGitCredential(
  provider: GitCredentialProvider,
  token: string
): Promise<GitCredentialSummary> {
  const res = await authFetch(`/api/me/git-credentials/${encodeURIComponent(provider)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Failed to save git credential");
  }
  return data.credential;
}

export async function deleteGitCredential(provider: GitCredentialProvider): Promise<void> {
  const res = await authFetch(`/api/me/git-credentials/${encodeURIComponent(provider)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    throw new Error("Failed to revoke git credential");
  }
}

// ==========================================
// PROJECT MEMBERS & PERMISSIONS
// ==========================================

export async function fetchProjectMembers(projectId: string): Promise<ProjectMemberWithUser[]> {
  const res = await authFetch(`/api/projects/${encodeURIComponent(projectId)}/members`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to fetch project members");
  }
  const data = await res.json();
  return data.members || [];
}

export async function addProjectMember(
  projectId: string,
  userId: string,
  projectRole: ProjectRole
): Promise<ProjectMemberWithUser> {
  const res = await authFetch(`/api/projects/${encodeURIComponent(projectId)}/members`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId, projectRole }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Failed to add project member");
  }
  return data.member;
}

export async function updateProjectMemberRole(
  projectId: string,
  userId: string,
  projectRole: ProjectRole
): Promise<void> {
  const res = await authFetch(
    `/api/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectRole }),
    }
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to update project member role");
  }
}

export async function removeProjectMember(
  projectId: string,
  userId: string
): Promise<void> {
  const res = await authFetch(
    `/api/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`,
    {
      method: "DELETE",
    }
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to remove project member");
  }
}

// ==========================================
// AUDIT LOGS (ADMIN)
// ==========================================

export async function fetchAuditLogs(params?: {
  action?: AuditAction | undefined;
  actorUserId?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}): Promise<{ logs: AuditLogEntry[]; total: number }> {
  const query = new URLSearchParams();
  if (params?.action) query.set("action", params.action);
  if (params?.actorUserId) query.set("actorUserId", params.actorUserId);
  if (params?.limit) query.set("limit", params.limit.toString());
  if (params?.offset) query.set("offset", params.offset.toString());

  const res = await authFetch(`/api/audit-logs?${query.toString()}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to fetch audit logs");
  }
  return await res.json();
}


// ==========================================
// PROJECT STRUCTURAL INDEX
// ==========================================

export type IndexJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface ProjectIndexJob {
  readonly id: string;
  readonly status: IndexJobStatus;
  readonly ref?: string;
  readonly commitSha?: string;
  readonly progress: {
    readonly phase: string;
    readonly done: number;
    readonly total: number;
    readonly message?: string;
  };
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly error?: string;
}

export interface ProjectIndexHistoryEntry extends ProjectIndexJob {
  readonly stats?: {
    readonly indexedFilesCount: number;
    readonly skippedFilesCount: number;
    readonly reusedFilesCount: number;
    readonly totalSymbols: number;
    readonly durationMs: number;
  };
}

export interface ProjectIndexSummary {
  readonly ref: string;
  readonly commitSha: string;
  readonly createdAt: string;
  readonly stats: {
    readonly indexedFilesCount: number;
    readonly skippedFilesCount: number;
    readonly reusedFilesCount: number;
    readonly downloadedFilesCount: number;
    readonly totalSymbols: number;
    readonly totalBytes: number;
    readonly durationMs: number;
    readonly countsByLanguage: Readonly<Record<string, number>>;
  };
  readonly workspaces: readonly { readonly name: string; readonly rootPath: string }[];
  readonly pathAliases: Readonly<Record<string, readonly string[]>>;
  readonly topImportedFiles: readonly { readonly file: string; readonly importedByCount: number }[];
}

export interface ProjectIndexResponse {
  readonly job: ProjectIndexJob | null;
  readonly index: ProjectIndexSummary | null;
}

async function indexRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await authFetch(url, init);
  const data = await res.json().catch(() => undefined);
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  if (data === undefined || data === null || typeof data !== "object") {
    throw new Error("Unexpected response from the server. Restart the dev server so it picks up the latest API routes.");
  }
  return data as T;
}

export function fetchProjectIndex(projectId: string): Promise<ProjectIndexResponse> {
  return indexRequest(`/api/projects/${encodeURIComponent(projectId)}/index`);
}

export async function fetchProjectIndexHistory(
  projectId: string,
): Promise<ProjectIndexHistoryEntry[]> {
  const data = await indexRequest<{ history: ProjectIndexHistoryEntry[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/index/history`,
  );
  return data.history ?? [];
}

export function startProjectIndex(
  projectId: string,
  ref?: string,
  gitToken?: string,
): Promise<{ job: ProjectIndexJob }> {
  return indexRequest(`/api/projects/${encodeURIComponent(projectId)}/index`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(gitToken ? { "x-git-token": gitToken } : {}),
    },
    body: JSON.stringify(ref ? { ref } : {}),
  });
}

export function cancelProjectIndex(projectId: string): Promise<{ cancelled: boolean }> {
  return indexRequest(`/api/projects/${encodeURIComponent(projectId)}/index/job`, {
    method: "DELETE",
  });
}

export interface ProjectBranches {
  readonly defaultBranch: string;
  readonly branches: readonly string[];
}

export function fetchProjectBranches(
  projectId: string,
  gitToken?: string,
): Promise<ProjectBranches> {
  return indexRequest(
    `/api/projects/${encodeURIComponent(projectId)}/index/branches`,
    gitToken ? { headers: { "x-git-token": gitToken } } : undefined,
  );
}
