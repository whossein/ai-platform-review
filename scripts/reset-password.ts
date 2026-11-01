/**
 * Local-only password recovery (no HTTP endpoint, so nothing to remove for production).
 *
 *   npm run reset-password                          # list users
 *   npm run reset-password -- <email> <newPassword> # reset one user's password
 *
 * Stop the server first: it keeps users in memory and would overwrite this change.
 * Reads/writes ./.data of the current directory, like the server does.
 */
import { SecurityContext } from "../apps/api/src/security/index.js";

const [email, newPassword] = process.argv.slice(2);
const security = new SecurityContext("./.data");

const users = await security.userStore.listUsers();

if (!email) {
  if (users.length === 0) console.log("No users yet - open the app and run the first-run setup.");
  for (const u of users) console.log(`${u.email}\t${u.role}\t${u.status}\t${u.name}`);
  process.exit(0);
}

const user = users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
if (!user) {
  console.error(`No user with email "${email}". Existing users:\n${users.map((u) => `  ${u.email}`).join("\n")}`);
  process.exit(1);
}
if (!newPassword) {
  console.error("Usage: npm run reset-password -- <email> <newPassword>");
  process.exit(1);
}

try {
  await security.userStore.resetPassword(user.id, newPassword);
} catch (err) {
  console.error(`Could not reset password: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
await security.sessionStore.revokeAllUserSessions(user.id);
if (user.status === "DISABLED") {
  await security.userStore.setUserStatus(user.id, "ACTIVE");
  console.log("Account was disabled; re-enabled it.");
}
await security.auditStore.log({
  actorUserId: null,
  actorName: "local-cli",
  action: "PASSWORD_RESET",
  entityType: "user",
  entityId: user.id,
  metadata: { via: "scripts/reset-password" },
});
console.log(`Password reset for ${user.email}. Existing sessions were signed out.`);
process.exit(0);
