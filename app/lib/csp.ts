/** Content Security Policy for HTML responses. Scripts: same origin, a per-request nonce and pinned hashes only. */
export function buildCsp(opts: { nonce: string; inlineHashes?: string[] }): string {
  const hashes = (opts.inlineHashes ?? []).map((h) => ` '${h}'`).join("");
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${opts.nonce}'${hashes}`,
    // Components set inline style attributes (motion, layout); scripts stay locked down.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    // Paymob's hosted page is reached by a redirect after a same-origin form post.
    "form-action 'self' https://accept.paymob.com",
  ].join("; ");
}

export function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

export async function scriptHash(source: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return `sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}`;
}
