/**
 * Audit Log Route Handlers.
 */

import type { AuditAction } from "@ai-review/core";
import type { SecurityContext } from "../security/security-context.js";

export async function getAuditLogsHandler(
  security: SecurityContext,
  query: any
) {
  const action = query?.action as AuditAction | undefined;
  const actorUserId = query?.actorUserId as string | undefined;
  const entityType = query?.entityType as string | undefined;
  const entityId = query?.entityId as string | undefined;
  const limit = query?.limit ? parseInt(query.limit, 10) : 50;
  const offset = query?.offset ? parseInt(query.offset, 10) : 0;

  return security.auditStore.query({
    action,
    actorUserId,
    entityType,
    entityId,
    limit,
    offset,
  });
}
