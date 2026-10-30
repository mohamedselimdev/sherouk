import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Db } from "../db";
import { invites, roleAssignments, roles, sessions, users } from "../../db/schema";
import { audit } from "../audit";
import {
  decryptSecret,
  dummyPasswordHash,
  encryptSecret,
  hashPassword,
  hmacHex,
  randomToken,
  safeEqual,
  sha256Hex,
  verifyPassword,
} from "../security/crypto";
import { hit, resetKey, TooManyRequestsError } from "../security/throttle";
import { newTotpSecret, otpauthUri, verifyTotp } from "../security/totp";

export type AuthConfig = { sessionSecret: string; mfaKey: string };

export class AuthError extends Error {
  constructor(
    public code:
      "invalid_credentials" | "locked" | "invalid_code" | "invalid_invite" | "weak_password" | "no_session",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "AuthError";
  }
}

const ABSOLUTE_MS = 12 * 3600_000;
const IDLE_MS = 2 * 3600_000;
const PENDING_MS = 10 * 60_000;
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60_000;
const INVITE_MS = 72 * 3600_000;

export type StaffSession = {
  sessionId: string;
  tokenHash: string;
  user: { id: string; email: string; displayName: string; locale: string; mfaEnrolled: boolean };
  mfaVerified: boolean;
};

/** Minimum bar for staff passwords: length beats composition rules. */
export function assertStrongPassword(password: string): void {
  if (password.length < 12 || password.length > 200)
    throw new AuthError("weak_password", "Password must be 12–200 characters");
}

export async function loginWithPassword(
  db: Db,
  input: { email: string; password: string; ip: string; userAgent?: string },
): Promise<{ token: string }> {
  const email = input.email.trim().toLowerCase();
  await hit(db, `staff-login:ip:${input.ip}`, 20, 600);
  await hit(db, `staff-login:acct:${email}`, 10, 600);

  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);
  const hash = user?.passwordHash ?? (await dummyPasswordHash());
  const passwordOk = await verifyPassword(input.password, hash);

  if (!user || user.status !== "active" || !passwordOk) {
    if (user && !passwordOk) {
      const fails = user.failedLogins + 1;
      await db
        .update(users)
        .set({
          failedLogins: fails,
          lockedUntil: fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MS) : user.lockedUntil,
        })
        .where(eq(users.id, user.id));
      await audit(db, { actorId: user.id, action: "auth.login_failed" });
    }
    throw new AuthError("invalid_credentials");
  }
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) throw new AuthError("invalid_credentials");

  await db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, user.id));
  const token = randomToken();
  await db.insert(sessions).values({
    userId: user.id,
    tokenHash: await sha256Hex(token),
    expiresAt: new Date(Date.now() + PENDING_MS),
    userAgent: input.userAgent?.slice(0, 200),
  });
  await audit(db, { actorId: user.id, action: "auth.password_ok" });
  return { token };
}

export async function getStaffSession(db: Db, token: string | undefined): Promise<StaffSession | null> {
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const [row] = await db
    .select({ s: sessions, u: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1);
  if (!row) return null;
  const now = Date.now();
  const { s, u } = row;
  if (s.revokedAt || s.expiresAt.getTime() <= now || u.status !== "active") return null;
  if (s.mfaVerifiedAt && now - s.lastSeenAt.getTime() > IDLE_MS) return null;
  if (s.mfaVerifiedAt && now - s.lastSeenAt.getTime() > 60_000) {
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date(now) })
      .where(eq(sessions.id, s.id));
  }
  return {
    sessionId: s.id,
    tokenHash,
    user: {
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      locale: u.locale,
      mfaEnrolled: !!u.mfaEnrolledAt,
    },
    mfaVerified: !!s.mfaVerifiedAt,
  };
}

async function promote(db: Db, sessionId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ mfaVerifiedAt: new Date(), expiresAt: new Date(Date.now() + ABSOLUTE_MS), lastSeenAt: new Date() })
    .where(eq(sessions.id, sessionId));
}

/** Step 1 of enrolment: stores a fresh (not yet trusted) secret and returns it for the authenticator app. */
export async function startMfaEnrolment(
  db: Db,
  cfg: AuthConfig,
  session: StaffSession,
): Promise<{ secret: string; uri: string }> {
  if (session.user.mfaEnrolled) throw new AuthError("invalid_code", "Already enrolled");
  const secret = newTotpSecret();
  await db
    .update(users)
    .set({ mfaSecretEnc: await encryptSecret(secret, cfg.mfaKey), mfaLastStep: null })
    .where(eq(users.id, session.user.id));
  return { secret, uri: otpauthUri(secret, session.user.email) };
}

/** Shows the same pending secret on page reloads; only generates one when none is stored yet. */
export async function pendingMfaSecret(
  db: Db,
  cfg: AuthConfig,
  session: StaffSession,
): Promise<{ secret: string; uri: string }> {
  const [u] = await db.select().from(users).where(eq(users.id, session.user.id)).limit(1);
  if (u?.mfaSecretEnc && !u.mfaEnrolledAt) {
    const secret = await decryptSecret(u.mfaSecretEnc, cfg.mfaKey);
    return { secret, uri: otpauthUri(secret, session.user.email) };
  }
  return startMfaEnrolment(db, cfg, session);
}

export async function confirmMfaEnrolment(
  db: Db,
  cfg: AuthConfig,
  session: StaffSession,
  code: string,
  now = Date.now(),
): Promise<void> {
  await hit(db, `staff-mfa:${session.user.id}`, 10, 600);
  const [u] = await db.select().from(users).where(eq(users.id, session.user.id)).limit(1);
  if (!u?.mfaSecretEnc || u.mfaEnrolledAt) throw new AuthError("invalid_code");
  const step = await verifyTotp(await decryptSecret(u.mfaSecretEnc, cfg.mfaKey), code, now, null);
  if (step === null) throw new AuthError("invalid_code");
  await db.update(users).set({ mfaEnrolledAt: new Date(), mfaLastStep: step }).where(eq(users.id, u.id));
  await promote(db, session.sessionId);
  await audit(db, { actorId: u.id, action: "auth.mfa_enrolled" });
}

export async function verifyMfa(
  db: Db,
  cfg: AuthConfig,
  session: StaffSession,
  code: string,
  now = Date.now(),
): Promise<void> {
  await hit(db, `staff-mfa:${session.user.id}`, 10, 600);
  const [u] = await db.select().from(users).where(eq(users.id, session.user.id)).limit(1);
  if (!u?.mfaSecretEnc || !u.mfaEnrolledAt) throw new AuthError("invalid_code");
  const step = await verifyTotp(await decryptSecret(u.mfaSecretEnc, cfg.mfaKey), code, now, u.mfaLastStep);
  if (step === null) {
    await audit(db, { actorId: u.id, action: "auth.mfa_failed" });
    throw new AuthError("invalid_code");
  }
  await db.update(users).set({ mfaLastStep: step }).where(eq(users.id, u.id));
  await resetKey(db, `staff-mfa:${u.id}`);
  await promote(db, session.sessionId);
  await audit(db, { actorId: u.id, action: "auth.login_ok" });
}

export async function logoutStaff(db: Db, session: StaffSession): Promise<void> {
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, session.sessionId));
}

export async function revokeAllSessions(db: Db, userId: string, actorId: string | null): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  await audit(db, { actorId, action: "staff.sessions_revoked", entityType: "user", entityId: userId });
}

/** CSRF token bound to the session; verified on every authenticated state-changing request. */
export function csrfToken(cfg: AuthConfig, session: Pick<StaffSession, "tokenHash">): Promise<string> {
  return hmacHex(cfg.sessionSecret, `csrf:${session.tokenHash}`);
}

export async function verifyCsrf(
  cfg: AuthConfig,
  session: Pick<StaffSession, "tokenHash">,
  submitted: string | null | undefined,
): Promise<boolean> {
  if (!submitted) return false;
  return safeEqual(await csrfToken(cfg, session), submitted);
}

export async function createInvite(
  db: Db,
  input: { actorId: string; email: string; roleKey: string; branchId: string | null },
): Promise<{ token: string; expiresAt: Date }> {
  const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, input.roleKey)).limit(1);
  if (!role) throw new AuthError("invalid_invite", "Unknown role");
  const token = randomToken();
  const expiresAt = new Date(Date.now() + INVITE_MS);
  await db.insert(invites).values({
    email: input.email.trim().toLowerCase(),
    roleId: role.id,
    branchId: input.branchId,
    tokenHash: await sha256Hex(token),
    invitedBy: input.actorId,
    expiresAt,
  });
  await audit(db, {
    actorId: input.actorId,
    action: "staff.invited",
    entityType: "role",
    entityId: input.roleKey,
    branchId: input.branchId,
  });
  return { token, expiresAt };
}

export async function acceptInvite(
  db: Db,
  input: { token: string; displayName: string; password: string; locale: "ar" | "en" },
): Promise<{ userId: string }> {
  assertStrongPassword(input.password);
  const tokenHash = await sha256Hex(input.token);
  return db.transaction(async (tx) => {
    const [inv] = await tx
      .update(invites)
      .set({ acceptedAt: new Date() })
      .where(
        and(eq(invites.tokenHash, tokenHash), isNull(invites.acceptedAt), gt(invites.expiresAt, new Date())),
      )
      .returning();
    if (!inv) throw new AuthError("invalid_invite");
    const [user] = await tx
      .insert(users)
      .values({
        email: inv.email,
        displayName: input.displayName.trim().slice(0, 100),
        passwordHash: await hashPassword(input.password),
        locale: input.locale,
      })
      .returning({ id: users.id });
    await tx.insert(roleAssignments).values({ userId: user!.id, roleId: inv.roleId, branchId: inv.branchId });
    await audit(tx, {
      actorId: user!.id,
      action: "staff.invite_accepted",
      entityType: "user",
      entityId: user!.id,
    });
    return { userId: user!.id };
  });
}

export { TooManyRequestsError };
