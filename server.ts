import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import {
  SPECIALISTS,
  makeSpecialistDefinition,
  makeSpecialistHandler,
  loadDotEnv,
} from "@ai-review/shared";
import { MapAgentRegistry } from "@ai-review/agent-runtime";
import { PersistentMemoryStore } from "@ai-review/memory";
import type { GitCredentialProvider, ProjectId } from "@ai-review/core";
import {
  estimateHandler,
  reviewHandler,
  publishHandler,
  applyLocalHandler,
  codeContextHandler,
  suggestCodeHandler,
  commitSuggestionHandler,
  modelsHandler,
  testProviderHandler,
  testGitConnectionHandler,
  listProjectsHandler,
  getProjectDetailsHandler,
  createProjectHandler,
  updateProjectHandler,
  findOrCreateProjectHandler,
  recordReviewHandler,
  submitFeedbackHandler,
  deleteProjectHandler,
  getAuthStatusHandler,
  setupFirstAdminHandler,
  loginHandler,
  logoutHandler,
  updateProfileHandler,
  changePasswordHandler,
  listSessionsHandler,
  revokeSessionHandler,
  listUsersHandler,
  getUserHandler,
  createUserHandler,
  updateUserHandler,
  setUserStatusHandler,
  setUserRoleHandler,
  resetUserPasswordHandler,
  deleteUserHandler,
  getGitCredentialsHandler,
  setGitCredentialHandler,
  deleteGitCredentialHandler,
  listProjectMembersHandler,
  addProjectMemberHandler,
  updateProjectMemberRoleHandler,
  removeProjectMemberHandler,
  getAuditLogsHandler,
  startProjectIndexHandler,
  cancelProjectIndexHandler,
  listProjectBranchesHandler,
  getProjectIndexHandler,
  getProjectIndexHistoryHandler,
  startProjectScanHandler,
  cancelProjectScanHandler,
  getProjectScanHandler,
  ensureProjectIndexed,
  buildProjectReviewContext,
} from "./apps/api/src/handlers/index.js";
import { ProjectIndexStore, IndexJobManager } from "@ai-review/project-index";
import { ProjectStore } from "./apps/api/src/project-store.js";
import { ScanStore, ScanJobManager } from "./apps/api/src/scan-manager.js";
import { SecurityContext } from "./apps/api/src/security/index.js";

loadDotEnv();

// Map AI Studio's default Gemini API key to this project's expected variables
if (process.env.GEMINI_API_KEY) {
  if (!process.env.AI_REVIEW_LLM_API_KEY) {
    process.env.AI_REVIEW_LLM_API_KEY = process.env.GEMINI_API_KEY;
  }
  if (!process.env.AI_REVIEW_LLM_PROVIDER) {
    process.env.AI_REVIEW_LLM_PROVIDER = "gemini";
  }
}

if (process.env.AVALAI_API_KEY && !process.env.AI_REVIEW_AVALAI_API_KEY) {
  process.env.AI_REVIEW_AVALAI_API_KEY = process.env.AVALAI_API_KEY;
}

async function startServer() {
  const app = express();
  const portArgIndex = process.argv.indexOf("--port");
  const cliPort = portArgIndex !== -1 ? parseInt(process.argv[portArgIndex + 1], 10) : undefined;
  const envPort = parseInt(process.env.PORT || "", 10);
  const PORT = cliPort || (Number.isNaN(envPort) ? 3000 : envPort);

  // Build and populate the agent registry at startup (composition root)
  const agentRegistry = new MapAgentRegistry();
  for (const spec of SPECIALISTS) {
    agentRegistry.register({
      definition: makeSpecialistDefinition(spec, process.env as Record<string, string>),
      handler: makeSpecialistHandler(spec, process.env as Record<string, string>),
    });
  }

  // Persistent storage injection at composition root
  const memoryStore = new PersistentMemoryStore("./.data/memory");
  const projectStore = new ProjectStore("./.data");
  const security = new SecurityContext("./.data");
  const indexStore = new ProjectIndexStore("./.data/index");
  const indexJobs = new IndexJobManager(indexStore);
  const scanStore = new ScanStore("./.data/scans");
  const scanJobs = new ScanJobManager(scanStore, indexJobs);
  const indexDeps = { projectStore, security, indexStore, indexJobs };
  const scanDeps = { ...indexDeps, scanStore, scanJobs };

  app.use(express.json({ limit: "50mb" }));

  // Helper middleware for optional authentication (populates req.user if token valid)
  const populateAuth = async (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    try {
      const auth = await security.authenticateRequest(req);
      if (auth) {
        (req as any).user = auth.user;
        (req as any).session = auth.session;
      }
    } catch {
      // Ignored for optional auth
    }
    next();
  };

  const requireAuth = security.requireAuth();
  const requireAdmin = security.requireAdmin();

  // Public Health Endpoint
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // ==========================================
  // AUTHENTICATION & SESSION ROUTES
  // ==========================================

  app.get("/api/auth/status", async (req, res) => {
    try {
      const result = await getAuthStatusHandler(security, req);
      res.status(200).json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to check auth status" });
    }
  });

  app.post("/api/auth/setup", async (req, res) => {
    try {
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      const result = await setupFirstAdminHandler(security, req.body || {}, ip);
      res.status(201).json(result);
    } catch (err: any) {
      res.status(err.status || 500).json({
        error: err.message || "First-run setup failed",
        code: err.code,
      });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      const userAgent = req.headers["user-agent"] || "";
      const result = await loginHandler(security, req.body || {}, ip, userAgent);
      res.status(200).json(result);
    } catch (err: any) {
      res.status(err.status || 401).json({
        error: err.message || "Login failed",
        code: err.code,
      });
    }
  });

  app.post("/api/auth/logout", populateAuth, async (req, res) => {
    try {
      const token = security.extractToken(req);
      const user = (req as any).user;
      const result = await logoutHandler(security, token, user);
      res.status(200).json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Logout failed" });
    }
  });

  app.get("/api/auth/me", requireAuth, (req, res) => {
    res.status(200).json({ user: (req as any).user });
  });

  app.patch("/api/auth/me", requireAuth, async (req, res) => {
    try {
      const updated = await updateProfileHandler(security, (req as any).user, req.body || {});
      res.status(200).json({ user: updated });
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message || "Failed to update profile" });
    }
  });

  app.post("/api/auth/change-password", requireAuth, async (req, res) => {
    try {
      const result = await changePasswordHandler(security, (req as any).user, req.body || {});
      res.status(200).json(result);
    } catch (err: any) {
      res.status(err.status || 400).json({
        error: err.message || "Failed to change password",
        code: err.code,
      });
    }
  });

  app.get("/api/auth/sessions", requireAuth, async (req, res) => {
    try {
      const token = security.extractToken(req) || undefined;
      const sessions = await listSessionsHandler(security, (req as any).user, token);
      res.status(200).json({ sessions });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to list sessions" });
    }
  });

  app.delete("/api/auth/sessions/:id", requireAuth, async (req, res) => {
    try {
      const result = await revokeSessionHandler(security, (req as any).user, req.params.id);
      res.status(200).json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to revoke session" });
    }
  });

  // ==========================================
  // USER MANAGEMENT ROUTES (ADMIN ONLY)
  // ==========================================

  app.get("/api/users", requireAdmin, async (_req, res) => {
    try {
      const users = await listUsersHandler(security);
      res.status(200).json({ users });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to list users" });
    }
  });

  app.post("/api/users", requireAdmin, async (req, res) => {
    try {
      const created = await createUserHandler(security, (req as any).user, req.body || {});
      res.status(201).json({ user: created });
    } catch (err: any) {
      res.status(err.status || 500).json({
        error: err.message || "Failed to create user",
        code: err.code,
      });
    }
  });

  app.get("/api/users/:id", requireAdmin, async (req, res) => {
    try {
      const user = await getUserHandler(security, req.params.id);
      res.status(200).json({ user });
    } catch (err: any) {
      res.status(err.status || 404).json({ error: err.message || "User not found" });
    }
  });

  app.patch("/api/users/:id", requireAdmin, async (req, res) => {
    try {
      const updated = await updateUserHandler(security, (req as any).user, req.params.id, req.body || {});
      res.status(200).json({ user: updated });
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message || "Failed to update user" });
    }
  });

  app.patch("/api/users/:id/status", requireAdmin, async (req, res) => {
    try {
      const updated = await setUserStatusHandler(
        security,
        (req as any).user,
        req.params.id,
        req.body?.status
      );
      res.status(200).json({ user: updated });
    } catch (err: any) {
      res.status(err.status || 400).json({
        error: err.message || "Failed to change user status",
        code: err.code,
      });
    }
  });

  app.patch("/api/users/:id/role", requireAdmin, async (req, res) => {
    try {
      const updated = await setUserRoleHandler(
        security,
        (req as any).user,
        req.params.id,
        req.body?.role
      );
      res.status(200).json({ user: updated });
    } catch (err: any) {
      res.status(err.status || 400).json({
        error: err.message || "Failed to change user role",
        code: err.code,
      });
    }
  });

  app.post("/api/users/:id/reset-password", requireAdmin, async (req, res) => {
    try {
      const result = await resetUserPasswordHandler(
        security,
        (req as any).user,
        req.params.id,
        req.body || {}
      );
      res.status(200).json(result);
    } catch (err: any) {
      res.status(err.status || 400).json({ error: err.message || "Failed to reset password" });
    }
  });

  app.delete("/api/users/:id", requireAdmin, async (req, res) => {
    try {
      const result = await deleteUserHandler(security, (req as any).user, req.params.id);
      res.status(200).json(result);
    } catch (err: any) {
      res.status(err.status || 400).json({
        error: err.message || "Failed to delete user",
        code: err.code,
      });
    }
  });

  // ==========================================
  // GIT CREDENTIALS ROUTES (USER SCOPED)
  // ==========================================

  app.get("/api/me/git-credentials", requireAuth, async (req, res) => {
    try {
      const credentials = await getGitCredentialsHandler(security, (req as any).user);
      res.status(200).json({ credentials });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to list credentials" });
    }
  });

  app.post("/api/me/git-credentials/:provider", requireAuth, async (req, res) => {
    try {
      const provider = req.params.provider.toLowerCase() as GitCredentialProvider;
      if (provider !== "github" && provider !== "gitlab") {
        return res.status(400).json({ error: "Unsupported provider. Must be 'github' or 'gitlab'." });
      }
      const summary = await setGitCredentialHandler(
        security,
        (req as any).user,
        provider,
        req.body || {}
      );
      res.status(200).json({ credential: summary });
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message || "Failed to save credential" });
    }
  });

  app.delete("/api/me/git-credentials/:provider", requireAuth, async (req, res) => {
    try {
      const provider = req.params.provider.toLowerCase() as GitCredentialProvider;
      const result = await deleteGitCredentialHandler(
        security,
        (req as any).user,
        provider
      );
      res.status(200).json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to revoke credential" });
    }
  });

  // ==========================================
  // AUDIT LOGS ROUTE (ADMIN ONLY)
  // ==========================================

  app.get("/api/audit-logs", requireAdmin, async (req, res) => {
    try {
      const result = await getAuditLogsHandler(security, req.query);
      res.status(200).json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to fetch audit logs" });
    }
  });

  // ==========================================
  // PROJECT REGISTRY & TEAM MEMBERS ROUTES
  // ==========================================

  app.get("/api/projects", requireAuth, async (req, res) => {
    try {
      const user = (req as any).user;
      const result = await listProjectsHandler(projectStore, security, user);
      res.status(200).json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to list projects" });
    }
  });

  app.get("/api/projects/:id", requireAuth, async (req, res) => {
    try {
      const user = (req as any).user;
      const result = await getProjectDetailsHandler(projectStore, req.params.id, security, user);
      res.status(200).json(result);
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message || "Failed to fetch project" });
    }
  });

  app.post("/api/projects", requireAuth, async (req, res) => {
    try {
      const user = (req as any).user;
      const result = await createProjectHandler(projectStore, req.body || {}, security, user);
      res.status(201).json(result);
    } catch (err: any) {
      res.status(err.status || 500).json({
        error: err.message || "Failed to create project",
        code: err.code,
        existingProject: err.existingProject,
      });
    }
  });

  app.post("/api/projects/find-or-create", requireAuth, async (req, res) => {
    try {
      const user = (req as any).user;
      const result = await findOrCreateProjectHandler(projectStore, req.body || {}, security, user);
      res.status(200).json(result);
    } catch (err: any) {
      res.status(err.status || 400).json({ error: err.message || "Failed to resolve project" });
    }
  });

  app.post("/api/projects/:id/reviews", requireAuth, async (req, res) => {
    try {
      const user = (req as any).user;
      const result = await recordReviewHandler(projectStore, req.params.id, req.body || {}, security, user);
      res.status(200).json(result);
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message || "Failed to record review" });
    }
  });

  app.post("/api/projects/:id/feedback", requireAuth, async (req, res) => {
    try {
      const user = (req as any).user;
      const result = await submitFeedbackHandler(projectStore, req.params.id, req.body || {}, security, user);
      res.status(200).json(result);
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message || "Failed to save feedback" });
    }
  });

  app.patch("/api/projects/:id", requireAuth, async (req, res) => {
    try {
      const user = (req as any).user;
      const result = await updateProjectHandler(projectStore, req.params.id, req.body || {}, security, user);
      res.status(200).json(result);
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message || "Failed to update project" });
    }
  });

  app.put("/api/projects/:id", requireAuth, async (req, res) => {
    try {
      const user = (req as any).user;
      const result = await updateProjectHandler(projectStore, req.params.id, req.body || {}, security, user);
      res.status(200).json(result);
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message || "Failed to update project" });
    }
  });

  app.delete("/api/projects/:id", requireAuth, async (req, res) => {
    try {
      const user = (req as any).user;
      const result = await deleteProjectHandler(projectStore, req.params.id, security, user);
      indexJobs.cancelJob(req.params.id);
      scanJobs.cancelJob(req.params.id);
      await indexStore.deleteProjectIndex(req.params.id).catch(() => undefined);
      await scanStore.deleteProject(req.params.id).catch(() => undefined);
      res.status(200).json(result);
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message || "Failed to delete project" });
    }
  });

  // Project Structural Index
  app.get("/api/projects/:id/index", requireAuth, async (req, res) => {
    try {
      res.status(200).json(await getProjectIndexHandler(indexDeps, req.params.id, (req as any).user));
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message || "Failed to read project index" });
    }
  });

  app.get("/api/projects/:id/index/history", requireAuth, async (req, res) => {
    try {
      res.status(200).json(await getProjectIndexHistoryHandler(indexDeps, req.params.id, (req as any).user));
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message || "Failed to read index history" });
    }
  });

  app.get("/api/projects/:id/index/branches", requireAuth, async (req, res) => {
    try {
      res.status(200).json(await listProjectBranchesHandler(indexDeps, req.params.id, (req as any).user, req.get("x-git-token") || undefined));
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message || "Failed to list branches" });
    }
  });

  app.post("/api/projects/:id/index", requireAuth, async (req, res) => {
    try {
      const result = await startProjectIndexHandler(indexDeps, req.params.id, (req as any).user, req.body || {}, req.get("x-git-token") || undefined);
      res.status(202).json(result);
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message || "Failed to start indexing" });
    }
  });

  app.delete("/api/projects/:id/index/job", requireAuth, async (req, res) => {
    try {
      res.status(200).json(await cancelProjectIndexHandler(indexDeps, req.params.id, (req as any).user));
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message || "Failed to cancel indexing" });
    }
  });

  // Project rule scan (no AI)
  app.get("/api/projects/:id/scan", requireAuth, async (req, res) => {
    try {
      res.status(200).json(await getProjectScanHandler(scanDeps, req.params.id, (req as any).user, { ref: req.query.ref }));
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message || "Failed to read scan" });
    }
  });

  app.post("/api/projects/:id/scan", requireAuth, async (req, res) => {
    try {
      const result = await startProjectScanHandler(scanDeps, req.params.id, (req as any).user, req.body || {}, req.get("x-git-token") || undefined);
      res.status(202).json(result);
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message || "Failed to start scan" });
    }
  });

  app.delete("/api/projects/:id/scan/job", requireAuth, async (req, res) => {
    try {
      res.status(200).json(await cancelProjectScanHandler(scanDeps, req.params.id, (req as any).user));
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message || "Failed to cancel scan" });
    }
  });

  // Project Members
  app.get("/api/projects/:id/members", requireAuth, async (req, res) => {
    try {
      const members = await listProjectMembersHandler(
        security,
        req.params.id as ProjectId,
        (req as any).user
      );
      res.status(200).json({ members });
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message || "Failed to list members" });
    }
  });

  app.post("/api/projects/:id/members", requireAuth, async (req, res) => {
    try {
      const member = await addProjectMemberHandler(
        security,
        req.params.id as ProjectId,
        (req as any).user,
        req.body || {}
      );
      res.status(201).json({ member });
    } catch (err: any) {
      res.status(err.status || 500).json({
        error: err.message || "Failed to add member",
        code: err.code,
      });
    }
  });

  app.patch("/api/projects/:id/members/:userId", requireAuth, async (req, res) => {
    try {
      const member = await updateProjectMemberRoleHandler(
        security,
        req.params.id as ProjectId,
        (req as any).user,
        req.params.userId,
        req.body || {}
      );
      res.status(200).json({ member });
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message || "Failed to update member" });
    }
  });

  app.delete("/api/projects/:id/members/:userId", requireAuth, async (req, res) => {
    try {
      const result = await removeProjectMemberHandler(
        security,
        req.params.id as ProjectId,
        (req as any).user,
        req.params.userId
      );
      res.status(200).json(result);
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message || "Failed to remove member" });
    }
  });

  // ==========================================
  // CODE REVIEW & PIPELINE ROUTES
  // ==========================================

  app.post("/api/estimate", requireAuth, async (req, res) => {
    try {
      const result = await estimateHandler(
        {
          diff: req.body?.diff,
          env: req.body?.env || req.body?.envOverrides,
        },
        agentRegistry
      );
      res.status(200).json(result);
    } catch (err: any) {
      const msg = err.message || "internal error";
      const isClientError = msg.includes("required") || msg.includes("invalid");
      res.status(isClientError ? 400 : 500).json({ error: msg });
    }
  });

  app.post("/api/review", requireAuth, async (req, res) => {
    try {
      const diffStr = (req.body?.diff || "").trim();
      const user = (req as any).user;

      // Pre-resolve project to inject custom system instructions and guidelines into AI context
      let preProject: any = undefined;
      let preMr: any = undefined;
      try {
        if (req.body?.projectId) {
          const fetched = await projectStore.getProject(req.body.projectId);
          if (fetched) preProject = fetched.project;
        } else if (diffStr.startsWith("http://") || diffStr.startsWith("https://")) {
          // Auto-registers the project and makes the caller its OWNER on first sight
          const auto = await findOrCreateProjectHandler(projectStore, { url: diffStr }, security, user);
          preProject = auto.project;
          preMr = auto.mergeRequest;
        }
      } catch (e) {
        console.warn("Pre-review project resolution notice:", e);
      }

      // Check project review permission if project identified and user authenticated
      if (preProject && user) {
        const canReview = await security.canAccessProject(user, preProject.id, "project:review");
        if (!canReview) {
          return res.status(403).json({
            error: "Access denied: You do not have permission to run reviews on this project.",
            code: "FORBIDDEN",
          });
        }
      }

      // Automatically inject the user's decrypted Git token for the repository's host.
      // GitHub hosts map to the github credential; every other host (including
      // self-hosted GitLab on a custom domain) uses the gitlab credential.
      const reviewEnv = { ...(req.body?.env || req.body?.envOverrides || {}) };
      if (user) {
        try {
          let host: string | undefined = preProject?.gitHost;
          if (!host && /^https?:\/\//.test(diffStr)) host = new URL(diffStr).host;
          if (host) {
            const provider = host.toLowerCase().includes("github") ? "github" : "gitlab";
            const token = await security.credentialStore.getDecryptedToken(user.id, provider);
            const envKey = provider === "github" ? "GITHUB_TOKEN" : "GITLAB_TOKEN";
            if (token && !reviewEnv[envKey]) reviewEnv[envKey] = token;
          }
        } catch (credErr) {
          console.warn("Credential injection notice:", credErr);
        }
      }

      // Keep the structural index fresh in the background and feed it to reviewers
      // The index of the MR's target branch is what reviewers need; the diff carries the change itself.
      const projectContextProvider =
        preProject && user
          ? async (paths: readonly string[], ctx: { targetBranch?: string | undefined; diff?: string | undefined }) => {
              const options = {
                ref: ctx.targetBranch,
                // Only the token that belongs to the project's own host; never cross hosts.
                tokenOverride: preProject.gitHost.toLowerCase().includes("github")
                  ? reviewEnv.GITHUB_TOKEN
                  : reviewEnv.GITLAB_TOKEN,
              };
              void ensureProjectIndexed(indexDeps, preProject, user, options);
              return buildProjectReviewContext(indexDeps, preProject, user, paths, { ...options, diff: ctx.diff });
            }
          : undefined;

      const feedbackDigest = preProject
        ? await projectStore.getFeedbackDigest(preProject.id).catch(() => "")
        : "";
      const customInstructions =
        [req.body?.customInstructions || preProject?.customInstructions, feedbackDigest]
          .filter(Boolean)
          .join("\n\n") || undefined;
      const projectName = req.body?.projectName || preProject?.name;

      if (user) {
        await security.auditStore.log({
          actorUserId: user.id,
          actorName: user.name,
          actorEmail: user.email,
          action: "REVIEW_STARTED",
          entityType: "review",
          entityId: preProject?.id || "ad-hoc",
          metadata: {
            projectName,
            hasCustomInstructions: Boolean(customInstructions),
          },
        });
      }

      const result = await reviewHandler(
        {
          diff: req.body?.diff,
          threshold: req.body?.threshold,
          env: reviewEnv,
          selectedSpecialists: req.body?.selectedSpecialists,
          customInstructions,
          projectName,
          ...(projectContextProvider ? { projectContextProvider } : {}),
        },
        agentRegistry,
        undefined,
        memoryStore
      );

      if (user) {
        await security.auditStore.log({
          actorUserId: user.id,
          actorName: user.name,
          actorEmail: user.email,
          action: "REVIEW_COMPLETED",
          entityType: "review",
          entityId: preProject?.id || "ad-hoc",
          metadata: {
            projectName,
            issuesCount: result.total,
            acceptedCount: result.accepted,
          },
        });
      }

      // Auto-associate review with project if diff is a URL or if projectId is supplied
      let associatedProject: any = preProject;
      let associatedMr: any = preMr;
      try {
        if (diffStr.startsWith("http://") || diffStr.startsWith("https://")) {
          if (!associatedProject) {
            const auto = await projectStore.findOrCreateFromUrl(diffStr);
            associatedProject = auto.project;
            associatedMr = auto.mergeRequest;
          }
          await projectStore.recordReview({
            projectId: associatedProject.id,
            mergeRequestId: associatedMr?.id,
            model: reviewEnv?.AI_REVIEW_LLM_MODEL || reviewEnv?.AI_REVIEW_LLM_PROVIDER,
            target: diffStr,
            inputMode: "pr",
            result,
          });
        } else if (req.body?.projectId) {
          await projectStore.recordReview({
            projectId: req.body.projectId,
            mergeRequestId: req.body.mergeRequestId,
            model: reviewEnv?.AI_REVIEW_LLM_MODEL || reviewEnv?.AI_REVIEW_LLM_PROVIDER,
            target: req.body.target || "Diff snippet",
            inputMode: req.body.inputMode || "diff",
            result,
          });
        }
      } catch (projErr) {
        console.warn("Project association error:", projErr);
      }

      res.status(200).json({
        ...result,
        ...(associatedProject ? { project: associatedProject } : {}),
        ...(associatedMr ? { mergeRequest: associatedMr } : {}),
      });
    } catch (err: any) {
      const msg = err.message || "internal error";
      const isClientError = msg.includes("required") || msg.includes("invalid");
      res.status(isClientError ? 400 : 500).json({ error: msg });
    }
  });

  app.post("/api/test-provider", requireAuth, async (req, res) => {
    try {
      const result = await testProviderHandler(req.body || {});
      res.status(200).json(result);
    } catch (err: any) {
      res.status(500).json({
        ok: false,
        error: err.message || "Internal error",
        latencyMs: err.latencyMs,
      });
    }
  });

  app.post("/api/test-git-connection", requireAuth, async (req, res) => {
    try {
      const result = await testGitConnectionHandler(req.body || {});
      res.status(200).json(result);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || "Internal error" });
    }
  });

  app.post("/api/models", requireAuth, async (req, res) => {
    try {
      const result = await modelsHandler(req.body || {});
      res.status(200).json(result);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || "Internal error" });
    }
  });

  app.post("/api/publish", requireAuth, async (req, res) => {
    try {
      const result = await publishHandler(req.body || {});
      res.status(200).json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "Internal error" });
    }
  });

  app.post("/api/code-context", requireAuth, async (req, res) => {
    try {
      res.status(200).json(await codeContextHandler(req.body || {}));
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "Internal error" });
    }
  });

  app.post("/api/suggest-code", requireAuth, async (req, res) => {
    try {
      res.status(200).json(await suggestCodeHandler(req.body || {}));
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "Internal error" });
    }
  });

  app.post("/api/commit-suggestion", requireAuth, async (req, res) => {
    try {
      res.status(200).json(await commitSuggestionHandler(req.body || {}));
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "Internal error" });
    }
  });

  app.post("/api/apply-local", requireAuth, async (req, res) => {
    try {
      const result = await applyLocalHandler(req.body || {});
      res.status(200).json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "internal error" });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    // Vite middleware for development
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
      root: path.resolve(process.cwd(), "apps/web"),
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), "apps/web/dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  // Keep connections alive during deep AI multi-agent reviews (10 mins)
  server.timeout = 600_000;
  server.keepAliveTimeout = 120_000;
  server.headersTimeout = 610_000;
}

startServer().catch(console.error);
