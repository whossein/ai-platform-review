/**
 * @ai-review/api/handlers
 *
 * Reusable route handlers extracted from server entry points.
 * These handlers encapsulate business logic and can be mounted on any HTTP framework
 * (Express, Node http, etc.) without duplication.
 */

export {
  estimateHandler,
  type EstimateRequest,
  type EstimateResponse,
} from "./estimate.js";

export {
  reviewHandler,
  type ReviewRequest,
  type ReviewResponse,
} from "./review.js";

export {
  testProviderHandler,
  type TestProviderRequest,
  type TestProviderResponse,
} from "./test-provider.js";

export {
  testGitConnectionHandler,
  type TestGitConnectionRequest,
  type TestGitConnectionResponse,
} from "./test-git-connection.js";

export {
  modelsHandler,
  type ModelsRequest,
  type ModelsResponse,
} from "./models.js";

export {
  publishHandler,
  type PublishRequest,
  type PublishResponse,
} from "./publish.js";

export {
  applyLocalHandler,
  type ApplyLocalRequest,
  type ApplyLocalResponse,
} from "./apply-local.js";

export {
  listProjectsHandler,
  getProjectDetailsHandler,
  createProjectHandler,
  updateProjectHandler,
  findOrCreateProjectHandler,
  recordReviewHandler,
  deleteProjectHandler,
} from "./projects.js";

export * from "./auth-handlers.js";
export * from "./user-handlers.js";
export * from "./credential-handlers.js";
export * from "./project-member-handlers.js";
export * from "./audit-handlers.js";


export {
  startProjectIndexHandler,
  cancelProjectIndexHandler,
  listProjectBranchesHandler,
  getProjectIndexHandler,
  getProjectIndexHistoryHandler,
  ensureProjectIndexed,
  buildProjectReviewContext,
  type IndexHandlerDeps,
} from "./index-handlers.js";
