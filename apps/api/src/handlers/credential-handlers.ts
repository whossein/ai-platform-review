/**
 * User Git Credentials Route Handlers.
 */

import type { SafeUser, GitCredentialProvider } from "@ai-review/core";
import type { SecurityContext } from "../security/security-context.js";

export async function getGitCredentialsHandler(
  security: SecurityContext,
  user: SafeUser
) {
  return security.credentialStore.listUserCredentials(user.id);
}

export async function setGitCredentialHandler(
  security: SecurityContext,
  user: SafeUser,
  provider: GitCredentialProvider,
  body: any
) {
  const token = body?.token || body?.personalAccessToken || "";
  const summary = await security.credentialStore.setCredential(
    user.id,
    provider,
    token
  );

  await security.auditStore.log({
    actorUserId: user.id,
    actorName: user.name,
    actorEmail: user.email,
    action: "GIT_CREDENTIAL_CONNECTED",
    entityType: "credential",
    entityId: `${user.id}:${provider}`,
    metadata: {
      provider,
      maskedToken: summary.maskedToken,
    },
  });

  return summary;
}

export async function deleteGitCredentialHandler(
  security: SecurityContext,
  user: SafeUser,
  provider: GitCredentialProvider
) {
  await security.credentialStore.deleteCredential(user.id, provider);

  await security.auditStore.log({
    actorUserId: user.id,
    actorName: user.name,
    actorEmail: user.email,
    action: "GIT_CREDENTIAL_REVOKED",
    entityType: "credential",
    entityId: `${user.id}:${provider}`,
    metadata: { provider },
  });

  return { success: true };
}
