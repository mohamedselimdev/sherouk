import { describe, expect, it } from "vitest";
import { buildCsp, randomNonce, scriptHash } from "../../app/lib/csp";

describe("csp", () => {
  it("locks scripts to self, the nonce and pinned hashes with no unsafe-inline for scripts", () => {
    const csp = buildCsp({ nonce: "abc", inlineHashes: ["sha256-xyz"] });
    const script = csp.split("; ").find((d) => d.startsWith("script-src"))!;
    expect(script).toBe("script-src 'self' 'nonce-abc' 'sha256-xyz'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  it("nonces are unique", () => {
    expect(randomNonce()).not.toBe(randomNonce());
  });

  it("hashes in the CSP format", async () => {
    expect(await scriptHash("")).toBe("sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=");
  });
});
