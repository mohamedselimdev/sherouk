import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const enc = new TextEncoder();

export function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const buf = Buffer.from(value, "base64");
  return new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
}

/** 256-bit random token, URL-safe. */
export function randomToken(bytes = 32): string {
  return toBase64Url(randomBytes(bytes));
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(value));
  return Buffer.from(digest).toString("hex");
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return Buffer.from(await crypto.subtle.sign("HMAC", key, enc.encode(message))).toString("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const SCRYPT = { N: 16384, r: 8, p: 1, keyLen: 32 } as const;

function scryptAsync(
  password: string,
  salt: Uint8Array,
  n: number,
  r: number,
  p: number,
  keyLen: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, keyLen, { N: n, r, p, maxmem: 128 * n * r * 2 }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

/** Format: scrypt$N$r$p$salt$hash (base64). Parameters travel with the hash so they can be raised later. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p, SCRYPT.keyLen);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scryptAsync(
    password,
    Buffer.from(salt, "base64"),
    Number(n),
    Number(r),
    Number(p),
    expected.length,
  );
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A valid hash of a random password, compared against when the account does not exist (equalises timing). */
let dummyHash: Promise<string> | undefined;
export function dummyPasswordHash(): Promise<string> {
  return (dummyHash ??= hashPassword(randomToken()));
}

async function aesKey(secretB64: string): Promise<CryptoKey> {
  const raw = fromBase64(secretB64);
  if (raw.length !== 32) throw new Error("MFA_ENCRYPTION_KEY must be 32 bytes (base64)");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** AES-256-GCM. Output: base64(iv || ciphertext+tag). */
export async function encryptSecret(plain: string, secretB64: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(secretB64), enc.encode(plain)),
  );
  return Buffer.concat([iv, ct]).toString("base64");
}

export async function decryptSecret(payload: string, secretB64: string): Promise<string> {
  const raw = fromBase64(payload);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: raw.slice(0, 12) },
    await aesKey(secretB64),
    raw.slice(12),
  );
  return new TextDecoder().decode(plain);
}
