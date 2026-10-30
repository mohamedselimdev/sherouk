import { sql } from "drizzle-orm";
import { createDb, type Db } from "../../server/db";
import { syncRolesAndPermissions } from "../../server/auth/rbac";
import { hashPassword } from "../../server/security/crypto";
import { branches, branchTranslations, roleAssignments, roles, users } from "../../db/schema";
import { eq } from "drizzle-orm";
import { TEST_URL } from "./global-setup";

export const CFG = {
  sessionSecret: "test-session-secret-0123456789abcdef",
  mfaKey: Buffer.alloc(32, 7).toString("base64"),
};
export const TEST_PASSWORD = "correct horse battery staple";

const handle = createDb(TEST_URL, 4);
export const db: Db = handle.db;
export const closeDb = () => handle.close();

/** Empties every table (keeps schema and migrations) and re-syncs roles/permissions. */
export async function reset(): Promise<void> {
  const rows = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public' and tablename <> '__drizzle_migrations'`,
  );
  const names = rows.map((r) => `"${r.tablename}"`).join(", ");
  await db.execute(sql.raw(`truncate table ${names} restart identity cascade`));
  await syncRolesAndPermissions(db);
}

export async function makeBranch(slug: string): Promise<string> {
  const [b] = await db.insert(branches).values({ slug, verified: true }).returning({ id: branches.id });
  await db.insert(branchTranslations).values([
    { branchId: b!.id, locale: "ar", name: `فرع ${slug}`, city: "القاهرة", address: "عنوان تجريبي" },
    { branchId: b!.id, locale: "en", name: `Branch ${slug}`, city: "Cairo", address: "Demo address" },
  ]);
  return b!.id;
}

export async function makeStaff(
  email: string,
  roleKey: string,
  branchId: string | null = null,
): Promise<string> {
  const [u] = await db
    .insert(users)
    .values({ email, displayName: email.split("@")[0]!, passwordHash: await hashPassword(TEST_PASSWORD) })
    .returning({ id: users.id });
  const [r] = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, roleKey));
  await db.insert(roleAssignments).values({ userId: u!.id, roleId: r!.id, branchId });
  return u!.id;
}
