import { describe, expect, it } from "vitest";
import { parseEnv } from "../../server/env";

const bucket = { put: () => {}, get: () => {}, delete: () => {} };
const valid = {
  APP_ENV: "staging",
  SITE_URL: "https://staging.example.com",
  SESSION_SECRET: "s".repeat(40),
  MFA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
  HYPERDRIVE: { connectionString: "postgres://x" },
  HYPERDRIVE_CATALOG: { connectionString: "postgres://y" },
  MEDIA: bucket,
};

describe("parseEnv", () => {
  it("accepts valid config", () => {
    expect(parseEnv(valid).APP_ENV).toBe("staging");
  });
  it("rejects bad values and names fields without leaking the values", () => {
    const bad = {
      ...valid,
      APP_ENV: "prod",
      SITE_URL: "secret-not-url",
      SESSION_SECRET: "short",
      MFA_ENCRYPTION_KEY: "AAAA",
    };
    expect(() => parseEnv(bad)).toThrow(/APP_ENV, SITE_URL, SESSION_SECRET, MFA_ENCRYPTION_KEY/);
    expect(() => parseEnv(bad)).not.toThrow(/secret-not-url/);
  });
  it("keeps cash on delivery off unless explicitly enabled", () => {
    expect(parseEnv(valid).ENABLE_COD).toBe("false");
    expect(parseEnv({ ...valid, ENABLE_COD: "true" }).ENABLE_COD).toBe("true");
    expect(() => parseEnv({ ...valid, ENABLE_COD: "yes" })).toThrow(/ENABLE_COD/);
  });
  it("requires both database bindings and the media bucket", () => {
    const rest: Record<string, unknown> = { ...valid };
    delete rest.HYPERDRIVE;
    delete rest.MEDIA;
    expect(() => parseEnv(rest)).toThrow(/HYPERDRIVE, MEDIA/);
  });
});
