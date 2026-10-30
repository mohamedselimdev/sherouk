import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  hashPassword,
  randomToken,
  safeEqual,
  verifyPassword,
} from "../../server/security/crypto";
import { base32Decode, base32Encode, totpCode, verifyTotp } from "../../server/security/totp";

describe("passwords", () => {
  it("verifies the right password and rejects wrong ones", async () => {
    const hash = await hashPassword("a long enough passphrase");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("a long enough passphrase", hash)).toBe(true);
    expect(await verifyPassword("a long enough passphrasf", hash)).toBe(false);
  });
  it("salts every hash and rejects malformed stored values", async () => {
    expect(await hashPassword("same same same")).not.toBe(await hashPassword("same same same"));
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });
});

describe("secret encryption", () => {
  const key = Buffer.alloc(32, 3).toString("base64");
  it("round-trips and uses a fresh IV", async () => {
    const a = await encryptSecret("JBSWY3DPEHPK3PXP", key);
    const b = await encryptSecret("JBSWY3DPEHPK3PXP", key);
    expect(a).not.toBe(b);
    expect(await decryptSecret(a, key)).toBe("JBSWY3DPEHPK3PXP");
  });
  it("fails on tampering and on the wrong key", async () => {
    const ct = await encryptSecret("secret", key);
    const tampered = Buffer.from(ct, "base64");
    tampered[tampered.length - 1] ^= 1;
    await expect(decryptSecret(tampered.toString("base64"), key)).rejects.toThrow();
    await expect(decryptSecret(ct, Buffer.alloc(32, 4).toString("base64"))).rejects.toThrow();
  });
  it("rejects keys of the wrong length", async () => {
    await expect(encryptSecret("x", Buffer.alloc(16).toString("base64"))).rejects.toThrow(/32 bytes/);
  });
});

describe("totp", () => {
  const secret = base32Encode(new TextEncoder().encode("12345678901234567890"));
  it("matches the RFC 6238 SHA-1 test vector (6-digit truncation)", async () => {
    expect(await totpCode(secret, 59_000)).toBe("287082");
    expect(await totpCode(secret, 1111111109_000)).toBe("081804");
    expect(await totpCode(secret, 1234567890_000)).toBe("005924");
  });
  it("accepts adjacent steps but never the same step twice", async () => {
    const t = 1234567890_000;
    const code = await totpCode(secret, t);
    const step = await verifyTotp(secret, code, t + 25_000, null);
    expect(step).not.toBeNull();
    expect(await verifyTotp(secret, code, t, step)).toBeNull();
  });
  it("rejects malformed and stale codes", async () => {
    expect(await verifyTotp(secret, "12345", 59_000, null)).toBeNull();
    expect(await verifyTotp(secret, "abcdef", 59_000, null)).toBeNull();
    expect(await verifyTotp(secret, await totpCode(secret, 59_000), 59_000 + 300_000, null)).toBeNull();
  });
  it("base32 round-trips", () => {
    const bytes = new Uint8Array([1, 2, 3, 250, 251, 252, 0, 9]);
    expect(Array.from(base32Decode(base32Encode(bytes)))).toEqual(Array.from(bytes));
  });
});

describe("helpers", () => {
  it("random tokens are unique and url-safe; safeEqual is exact", () => {
    expect(randomToken()).not.toBe(randomToken());
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
