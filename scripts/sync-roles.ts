/**
 * Makes the permissions and system roles in code the source of truth in the database. Idempotent and safe in any
 * environment: it never touches users, assignments or data. Run it after deploying a release that changes roles.
 *   DATABASE_URL=<migrator url> npm run db:sync-roles
 */
import { createDb } from "../server/db";
import { PERMISSIONS, ROLE_DEFS, syncRolesAndPermissions } from "../server/auth/rbac";

const url = process.env.DATABASE_URL ?? "postgres://shrouk:shrouk_local_only@127.0.0.1:54329/shrouk_dev";
const { db, close } = createDb(url, 1);
await syncRolesAndPermissions(db);
console.log(
  `synced ${Object.keys(PERMISSIONS).length} permissions and ${Object.keys(ROLE_DEFS).length} roles`,
);
await close();
