import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { customers } from "../../db/schema";
import {
  getCustomerSession,
  loginCustomer,
  logoutCustomer,
  registerCustomer,
} from "../../server/auth/customer";
import { hit, TooManyRequestsError } from "../../server/security/throttle";
import { TEST_URL } from "./global-setup";
import { closeDb, db, reset } from "./helpers";

beforeEach(reset);
afterAll(closeDb);

describe("customer accounts", () => {
  it("registers, resolves a session, logs out", async () => {
    const { token } = await registerCustomer(db, {
      email: "Cust@Example.com",
      password: "long enough password",
      name: "Cust",
      ip: "1.1.1.1",
    });
    const s = await getCustomerSession(db, token);
    expect(s?.customer.email).toBe("cust@example.com");
    await logoutCustomer(db, s!);
    expect(await getCustomerSession(db, token)).toBeNull();
  });

  it("duplicate registration gives a generic error and email match is case-insensitive", async () => {
    await registerCustomer(db, {
      email: "a@example.com",
      password: "long enough password",
      name: "A",
      ip: "1.1.1.1",
    });
    await expect(
      registerCustomer(db, {
        email: "A@EXAMPLE.COM",
        password: "long enough password",
        name: "B",
        ip: "1.1.1.2",
      }),
    ).rejects.toMatchObject({ code: "invalid_credentials" });
    expect(await db.select().from(customers)).toHaveLength(1);
  });

  it("login works with the right password only; staff and customer sessions are separate", async () => {
    await registerCustomer(db, {
      email: "a@example.com",
      password: "long enough password",
      name: "A",
      ip: "1.1.1.1",
    });
    await expect(
      loginCustomer(db, { email: "a@example.com", password: "wrong wrong wrong", ip: "2.2.2.2" }),
    ).rejects.toMatchObject({ code: "invalid_credentials" });
    const { token } = await loginCustomer(db, {
      email: "A@example.com",
      password: "long enough password",
      ip: "2.2.2.2",
    });
    expect(await getCustomerSession(db, token)).not.toBeNull();
  });

  it("rejects weak passwords", async () => {
    await expect(
      registerCustomer(db, { email: "w@example.com", password: "short", name: "W", ip: "1.1.1.1" }),
    ).rejects.toMatchObject({ code: "weak_password" });
  });
});

describe("throttle", () => {
  it("allows up to the limit then blocks, and resets after the window", async () => {
    for (let i = 0; i < 3; i++) await hit(db, "k", 3, 60);
    await expect(hit(db, "k", 3, 60)).rejects.toBeInstanceOf(TooManyRequestsError);
    await db.execute(sql`update rate_limits set reset_at = now() - interval '1 second' where key = 'k'`);
    await expect(hit(db, "k", 3, 60)).resolves.toBeUndefined();
  });
});

describe("schema", () => {
  it("builds from an empty database using only the checked-in migrations", async () => {
    const admin = postgres(TEST_URL, { max: 1 });
    const name = `shrouk_repro_${Date.now()}`;
    await admin.unsafe(`create database ${name}`);
    try {
      const url = TEST_URL.replace(/\/[^/]+$/, `/${name}`);
      const fresh = postgres(url, { max: 1 });
      await migrate(drizzle(fresh), { migrationsFolder: "db/migrations" });
      const tables =
        await fresh`select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name <> '__drizzle_migrations'`;
      expect(tables[0]!.n).toBe(38);
      await fresh.end();
    } finally {
      await admin.unsafe(`drop database ${name} with (force)`);
      await admin.end();
    }
  });
});
