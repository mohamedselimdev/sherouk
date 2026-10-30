import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditEntries, invites, sessions, users } from "../../db/schema";
import {
  acceptInvite,
  AuthError,
  confirmMfaEnrolment,
  createInvite,
  csrfToken,
  getStaffSession,
  loginWithPassword,
  logoutStaff,
  revokeAllSessions,
  startMfaEnrolment,
  verifyCsrf,
  verifyMfa,
} from "../../server/auth/staff";
import { decryptSecret } from "../../server/security/crypto";
import { totpCode } from "../../server/security/totp";
import { TooManyRequestsError } from "../../server/security/throttle";
import { CFG, closeDb, db, makeStaff, reset, TEST_PASSWORD } from "./helpers";

beforeEach(reset);
afterAll(closeDb);

const login = (email: string, password = TEST_PASSWORD, ip = "1.1.1.1") =>
  loginWithPassword(db, { email, password, ip });

async function fullLogin(email: string) {
  const { token } = await login(email);
  let session = (await getStaffSession(db, token))!;
  if (!session.user.mfaEnrolled) {
    const { secret } = await startMfaEnrolment(db, CFG, session);
    await confirmMfaEnrolment(db, CFG, session, await totpCode(secret, Date.now()));
  } else {
    const [u] = await db.select().from(users).where(eq(users.id, session.user.id));
    await verifyMfa(
      db,
      CFG,
      session,
      await totpCode(await decryptSecret(u!.mfaSecretEnc!, CFG.mfaKey), Date.now()),
    );
  }
  session = (await getStaffSession(db, token))!;
  return { token, session };
}

describe("staff login", () => {
  it("a password alone yields a session that is NOT mfa-verified", async () => {
    await makeStaff("a@shrouk.test", "hq_admin");
    const { token } = await login("a@shrouk.test");
    const s = await getStaffSession(db, token);
    expect(s).not.toBeNull();
    expect(s!.mfaVerified).toBe(false);
  });

  it("wrong password and unknown email fail with the same error", async () => {
    await makeStaff("a@shrouk.test", "hq_admin");
    const e1 = await login("a@shrouk.test", "wrong wrong wrong").catch((e) => e);
    const e2 = await login("nobody@shrouk.test").catch((e) => e);
    expect(e1).toBeInstanceOf(AuthError);
    expect(e2).toBeInstanceOf(AuthError);
    expect((e1 as AuthError).code).toBe("invalid_credentials");
    expect((e2 as AuthError).code).toBe((e1 as AuthError).code);
    expect((e2 as Error).message).toBe((e1 as Error).message);
  });

  it("locks the account after repeated failures, even for the right password", async () => {
    await makeStaff("a@shrouk.test", "hq_admin");
    for (let i = 0; i < 5; i++)
      await login("a@shrouk.test", "wrong wrong wrong", `9.9.9.${i}`).catch(() => {});
    await expect(login("a@shrouk.test", TEST_PASSWORD, "8.8.8.8")).rejects.toMatchObject({
      code: "invalid_credentials",
    });
  });

  it("throttles by IP", async () => {
    for (let i = 0; i < 20; i++) await login(`u${i}@shrouk.test`, "x".repeat(12), "7.7.7.7").catch(() => {});
    await expect(login("u99@shrouk.test", "x".repeat(12), "7.7.7.7")).rejects.toBeInstanceOf(
      TooManyRequestsError,
    );
  });

  it("disabled users cannot log in", async () => {
    const id = await makeStaff("a@shrouk.test", "hq_admin");
    await db.update(users).set({ status: "disabled" }).where(eq(users.id, id));
    await expect(login("a@shrouk.test")).rejects.toMatchObject({ code: "invalid_credentials" });
  });
});

describe("mfa", () => {
  it("enrols with a valid code and promotes the session", async () => {
    await makeStaff("a@shrouk.test", "hq_admin");
    const { session } = await fullLogin("a@shrouk.test");
    expect(session.mfaVerified).toBe(true);
    expect(session.user.mfaEnrolled).toBe(true);
  });

  it("stores the TOTP secret encrypted, never in plaintext", async () => {
    await makeStaff("a@shrouk.test", "hq_admin");
    const { token } = await login("a@shrouk.test");
    const s = (await getStaffSession(db, token))!;
    const { secret } = await startMfaEnrolment(db, CFG, s);
    const [u] = await db.select().from(users).where(eq(users.id, s.user.id));
    expect(u!.mfaSecretEnc).toBeTruthy();
    expect(u!.mfaSecretEnc).not.toContain(secret);
  });

  it("rejects a wrong code and does not promote", async () => {
    await makeStaff("a@shrouk.test", "hq_admin");
    const { token } = await login("a@shrouk.test");
    const s = (await getStaffSession(db, token))!;
    await startMfaEnrolment(db, CFG, s);
    await expect(confirmMfaEnrolment(db, CFG, s, "000000")).rejects.toMatchObject({ code: "invalid_code" });
    expect((await getStaffSession(db, token))!.mfaVerified).toBe(false);
  });

  it("refuses to reuse the same code on the next login", async () => {
    await makeStaff("a@shrouk.test", "hq_admin");
    const first = await fullLogin("a@shrouk.test");
    await logoutStaff(db, first.session);
    const { token } = await login("a@shrouk.test");
    const s = (await getStaffSession(db, token))!;
    const [u] = await db.select().from(users).where(eq(users.id, s.user.id));
    const code = await totpCode(await decryptSecret(u!.mfaSecretEnc!, CFG.mfaKey), Date.now());
    await expect(verifyMfa(db, CFG, s, code)).rejects.toMatchObject({ code: "invalid_code" });
  });
});

describe("sessions", () => {
  it("logout and revoke-all invalidate sessions", async () => {
    await makeStaff("a@shrouk.test", "hq_admin");
    const a = await fullLogin("a@shrouk.test");
    await logoutStaff(db, a.session);
    expect(await getStaffSession(db, a.token)).toBeNull();

    const { token } = await login("a@shrouk.test");
    expect(await getStaffSession(db, token)).not.toBeNull();
    await revokeAllSessions(db, a.session.user.id, null);
    expect(await getStaffSession(db, token)).toBeNull();
  });

  it("expired and idle sessions are rejected; only the token hash is stored", async () => {
    await makeStaff("a@shrouk.test", "hq_admin");
    const a = await fullLogin("a@shrouk.test");
    const [row] = await db.select().from(sessions).where(eq(sessions.id, a.session.sessionId));
    expect(row!.tokenHash).not.toBe(a.token);
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date(Date.now() - 3 * 3600_000) })
      .where(eq(sessions.id, a.session.sessionId));
    expect(await getStaffSession(db, a.token)).toBeNull();
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date(), expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.id, a.session.sessionId));
    expect(await getStaffSession(db, a.token)).toBeNull();
  });

  it("garbage tokens resolve to no session", async () => {
    expect(await getStaffSession(db, "nope")).toBeNull();
    expect(await getStaffSession(db, undefined)).toBeNull();
  });

  it("csrf tokens are bound to the session", async () => {
    await makeStaff("a@shrouk.test", "hq_admin");
    await makeStaff("b@shrouk.test", "hq_admin");
    const a = await fullLogin("a@shrouk.test");
    const b = await fullLogin("b@shrouk.test");
    const tokenA = await csrfToken(CFG, a.session);
    expect(await verifyCsrf(CFG, a.session, tokenA)).toBe(true);
    expect(await verifyCsrf(CFG, b.session, tokenA)).toBe(false);
    expect(await verifyCsrf(CFG, a.session, "")).toBe(false);
    expect(await verifyCsrf(CFG, a.session, null)).toBe(false);
  });
});

describe("invites", () => {
  it("creates a user with the invited role once, then the token is dead", async () => {
    const admin = await makeStaff("admin@shrouk.test", "hq_admin");
    const { token } = await createInvite(db, {
      actorId: admin,
      email: "New@Shrouk.test",
      roleKey: "marketing",
      branchId: null,
    });
    const { userId } = await acceptInvite(db, {
      token,
      displayName: "New",
      password: "long enough password",
      locale: "en",
    });
    expect(userId).toBeTruthy();
    await expect(
      acceptInvite(db, { token, displayName: "Again", password: "long enough password", locale: "en" }),
    ).rejects.toMatchObject({ code: "invalid_invite" });
    const s = await login("new@shrouk.test", "long enough password");
    expect(s.token).toBeTruthy();
  });

  it("rejects expired invites, unknown tokens and weak passwords", async () => {
    const admin = await makeStaff("admin@shrouk.test", "hq_admin");
    const { token } = await createInvite(db, {
      actorId: admin,
      email: "x@shrouk.test",
      roleKey: "marketing",
      branchId: null,
    });
    await expect(
      acceptInvite(db, { token, displayName: "X", password: "short", locale: "ar" }),
    ).rejects.toMatchObject({ code: "weak_password" });
    await expect(
      acceptInvite(db, { token: "bogus", displayName: "X", password: "long enough password", locale: "ar" }),
    ).rejects.toMatchObject({ code: "invalid_invite" });
    await db.update(invites).set({ expiresAt: new Date(Date.now() - 60_000) });
    await expect(
      acceptInvite(db, { token, displayName: "X", password: "long enough password", locale: "ar" }),
    ).rejects.toMatchObject({ code: "invalid_invite" });
  });

  it("an unknown role cannot be invited", async () => {
    const admin = await makeStaff("admin@shrouk.test", "hq_admin");
    await expect(
      createInvite(db, { actorId: admin, email: "x@shrouk.test", roleKey: "root", branchId: null }),
    ).rejects.toMatchObject({ code: "invalid_invite" });
  });
});

describe("audit", () => {
  it("records failed logins and successful mfa without secrets", async () => {
    await makeStaff("a@shrouk.test", "hq_admin");
    await login("a@shrouk.test", "wrong wrong wrong").catch(() => {});
    await fullLogin("a@shrouk.test");
    const entries = await db.select().from(auditEntries);
    const actions = entries.map((e) => e.action);
    expect(actions).toContain("auth.login_failed");
    expect(actions).toContain("auth.mfa_enrolled");
    expect(JSON.stringify(entries)).not.toContain(TEST_PASSWORD);
  });
});
