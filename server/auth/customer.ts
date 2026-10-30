import { eq, sql } from "drizzle-orm";
import type { Db } from "../db";
import { customerSessions, customers } from "../../db/schema";
import { dummyPasswordHash, hashPassword, randomToken, sha256Hex, verifyPassword } from "../security/crypto";
import { hit } from "../security/throttle";
import { AuthError, assertStrongPassword } from "./staff";

const SESSION_MS = 30 * 24 * 3600_000;

export type CustomerSession = { sessionId: string; customer: { id: string; email: string; name: string } };

async function open(db: Db, customerId: string): Promise<string> {
  const token = randomToken();
  await db
    .insert(customerSessions)
    .values({ customerId, tokenHash: await sha256Hex(token), expiresAt: new Date(Date.now() + SESSION_MS) });
  return token;
}

/** Returns a session token. A duplicate email gives the same generic error as any other failure (no enumeration). */
export async function registerCustomer(
  db: Db,
  input: { email: string; password: string; name: string; ip: string },
): Promise<{ token: string }> {
  await hit(db, `cust-register:ip:${input.ip}`, 10, 3600);
  assertStrongPassword(input.password);
  const email = input.email.trim().toLowerCase();
  try {
    const [row] = await db
      .insert(customers)
      .values({
        email,
        name: input.name.trim().slice(0, 100),
        passwordHash: await hashPassword(input.password),
      })
      .returning({ id: customers.id });
    return { token: await open(db, row!.id) };
  } catch (error) {
    if (
      (error as { code?: string }).code === "23505" ||
      (error as { cause?: { code?: string } }).cause?.code === "23505"
    ) {
      throw new AuthError("invalid_credentials", "Could not create account");
    }
    throw error;
  }
}

export async function loginCustomer(
  db: Db,
  input: { email: string; password: string; ip: string },
): Promise<{ token: string }> {
  const email = input.email.trim().toLowerCase();
  await hit(db, `cust-login:ip:${input.ip}`, 30, 600);
  await hit(db, `cust-login:acct:${email}`, 10, 600);
  const [c] = await db
    .select()
    .from(customers)
    .where(sql`lower(${customers.email}) = ${email}`)
    .limit(1);
  const ok = await verifyPassword(input.password, c?.passwordHash ?? (await dummyPasswordHash()));
  if (!c || !ok) throw new AuthError("invalid_credentials");
  return { token: await open(db, c.id) };
}

export async function getCustomerSession(db: Db, token: string | undefined): Promise<CustomerSession | null> {
  if (!token) return null;
  const [row] = await db
    .select({ s: customerSessions, c: customers })
    .from(customerSessions)
    .innerJoin(customers, eq(customers.id, customerSessions.customerId))
    .where(eq(customerSessions.tokenHash, await sha256Hex(token)))
    .limit(1);
  if (!row || row.s.revokedAt || row.s.expiresAt.getTime() <= Date.now()) return null;
  return { sessionId: row.s.id, customer: { id: row.c.id, email: row.c.email, name: row.c.name } };
}

export async function logoutCustomer(db: Db, session: CustomerSession): Promise<void> {
  await db
    .update(customerSessions)
    .set({ revokedAt: new Date() })
    .where(eq(customerSessions.id, session.sessionId));
}
