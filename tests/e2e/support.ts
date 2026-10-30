import { readFileSync } from "node:fs";
import { eq, inArray, like } from "drizzle-orm";
import { expect, type Page } from "@playwright/test";
import { createDb } from "../../server/db";
import { encryptSecret, hashPassword } from "../../server/security/crypto";
import { newTotpSecret, totpCode } from "../../server/security/totp";
import {
  roleAssignments,
  roles,
  users,
  rateLimits,
  productTranslations,
  products,
  customers,
} from "../../db/schema";

const DEV_URL = "postgres://shrouk:shrouk_local_only@127.0.0.1:54329/shrouk_dev";

function devVar(name: string): string {
  const line = readFileSync(".dev.vars", "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${name}=`));
  if (!line) throw new Error(`${name} missing from .dev.vars (run npm run dev:init)`);
  return line.slice(name.length + 1).trim();
}

export const E2E_PASSWORD = "e2e long test password 42";
export const E2E_EMAIL_PREFIX = "e2e-";

export type TestStaff = { email: string; secret: string };

/** Creates an MFA-enrolled staff user directly in the dev database (test fixture; never touches production). */
export async function makeStaff(
  label: string,
  roleKey: string,
  branchId: string | null = null,
): Promise<TestStaff> {
  const { db, close } = createDb(DEV_URL, 2);
  try {
    const email = `${E2E_EMAIL_PREFIX}${label}@shrouk.test`;
    await db.delete(users).where(eq(users.email, email));
    const secret = newTotpSecret();
    const [u] = await db
      .insert(users)
      .values({
        email,
        displayName: `E2E ${label}`,
        passwordHash: await hashPassword(E2E_PASSWORD),
        mfaSecretEnc: await encryptSecret(secret, devVar("MFA_ENCRYPTION_KEY")),
        mfaEnrolledAt: new Date(),
      })
      .returning({ id: users.id });
    const [r] = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, roleKey));
    await db.insert(roleAssignments).values({ userId: u!.id, roleId: r!.id, branchId });
    await db.delete(rateLimits);
    return { email, secret };
  } finally {
    await close();
  }
}

export async function cleanup(): Promise<void> {
  const { db, close } = createDb(DEV_URL, 2);
  try {
    await db.delete(users).where(like(users.email, `${E2E_EMAIL_PREFIX}%`));
    await db.delete(customers).where(like(customers.email, `${E2E_EMAIL_PREFIX}%`));
    const ids = await db
      .select({ id: productTranslations.productId })
      .from(productTranslations)
      .where(like(productTranslations.slug, "e2e-%"));
    if (ids.length)
      await db.delete(products).where(
        inArray(
          products.id,
          ids.map((i) => i.id),
        ),
      );
    await db.delete(rateLimits);
  } finally {
    await close();
  }
}

/**
 * The server refuses to accept the same TOTP step twice. Tests log in many times within one 30 s window,
 * so the fixture clears the stored step first and then uses the current code (the app logic is unchanged).
 */
export async function freshCode(staff: TestStaff): Promise<string> {
  const { db, close } = createDb(DEV_URL, 1);
  try {
    await db.update(users).set({ mfaLastStep: null }).where(eq(users.email, staff.email));
  } finally {
    await close();
  }
  return totpCode(staff.secret, Date.now());
}

export async function loginAsStaff(page: Page, staff: TestStaff, lang: "ar" | "en" = "en"): Promise<void> {
  await page.goto(`/${lang}/admin/login`);
  await page.waitForSelector("html[data-hydrated]");
  await page.getByLabel(/Email|البريد/).fill(staff.email);
  await page.getByLabel(/Password|كلمة المرور/).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: /Sign in|تسجيل الدخول/ }).click();
  await expect(page).toHaveURL(new RegExp(`/${lang}/admin/mfa$`));
  await page.getByLabel(/Code|الرمز/).fill(await freshCode(staff));
  await page.getByRole("button", { name: /Verify|تحقق/ }).click();
  await expect(page).toHaveURL(new RegExp(`/${lang}/admin$`));
}

/** 1x1 transparent PNG. */
export const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
