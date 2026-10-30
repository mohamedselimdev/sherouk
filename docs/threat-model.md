# Threat model

Baseline: OWASP ASVS (L2 target) and OWASP Top 10. Method: STRIDE per surface. Status of every control is **planned** in Phase 0; each is verified by test in the phase noted.

## Data classification

| Class | Examples | Handling |
|---|---|---|
| Restricted | Staff credentials/MFA secrets, session tokens, API secrets, (future) prescriptions | Hashed/encrypted, never logged, minimum access |
| Confidential PII | Customer name, phone, email, address, order history | Encrypted in transit and at rest (provider), role-gated, audited export, retention policy after legal review |
| Internal | Costs, margins, stock levels, audit logs | Role-gated |
| Public | Catalog, CMS, branch info | Cached allowed |

No PAN/CVV ever reaches our systems (Paymob hosted checkout). Prescription data is out of MVP.

## Surfaces and threats

| Surface | Threat | Control | Phase |
|---|---|---|---|
| Guest checkout | Price/qty tampering; duplicate submit; oversell | Server recomputes all totals from DB; idempotency key; transactional reservation | 4 |
| Cart | Cart ID guessing / session fixation | Opaque 128-bit ID, HttpOnly cookie, rotation on login | 3 |
| Login (staff/customer) | Credential stuffing, enumeration | Rate limit per IP+account, Turnstile after failures, uniform responses/timing, Argon2id/scrypt hashing compatible with Workers (spike) | 3 |
| Admin | Privilege escalation, IDOR across branches | Deny-by-default `authorize()`, branch predicate in repositories, tests for cross-branch denial, MFA (TOTP/passkey) | 3,6 |
| Sessions | Theft, fixation | Server-stored, hashed token, HttpOnly+Secure+SameSite=Lax (Strict for admin), idle+absolute expiry, revoke-all | 3 |
| CSRF | Forged state-changing requests | SameSite + per-session CSRF token on all actions, Origin check | 3 |
| XSS | Stored XSS via CMS/blog/product text | Output escaping by React; CMS limited to structured blocks + sanitised rich text allow-list; strict CSP with nonces; no raw HTML injection | 7,8 |
| Uploads | Malicious files, oversized, SVG scripts | Type sniffing, size limits, re-encode images, reject SVG for user uploads, random R2 keys, private bucket for non-public files, short-lived signed URLs | 3 |
| SQL injection | — | Drizzle parameterised queries only; no string-built SQL | all |
| Webhooks | Forged / replayed / out-of-order events | HMAC with timing-safe compare per Paymob spec, unique `provider_event_id`, amount/currency/order correlation, idempotent state transitions, optional provider re-query | 5 |
| Payment redirect | Treating return URL as proof | Redirect only shows "pending verification"; state changes only from verified webhook/reconciliation | 5 |
| Coupons | Brute force, stacking abuse, reuse | Rate limit, per-customer/global limits, unique redemption per order, stacking policy in pricing | 4 |
| Forms (contact, newsletter, appointments) | Spam, abuse | Turnstile verified server-side, rate limit, honeypot | 3–7 |
| Branch isolation | Branch manager reads another branch | Repository-level scoping; negative tests | 3,6 |
| Integrations (GA4, Meta, POS CSV) | Data leakage, malicious CSV | Consent gating, adapter allow-list, CSV size/row limits and schema validation, formula-injection escaping on export | 7 |
| Secrets | Leak via repo/logs | Worker secrets, `.env.example` only, secret scanning in CI, log redaction | 1,8 |
| Supply chain | Malicious dependency | Lockfile, `npm audit`, Dependabot, pinned CI actions | 1,8 |
| Information disclosure | Verbose errors, indexed admin | Generic errors, correlation IDs, `noindex` + auth on admin, no data in URLs | all |
| Availability | Bot traffic, queue flooding | Cloudflare rate limiting/WAF, DLQ and retry caps | 8 |

## Headers

CSP (nonce-based, `frame-ancestors 'none'`, allowlisted Paymob/Turnstile/analytics origins), HSTS, `X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, CORP/COOP; no wildcard CORS.

## Residual risks and open items

Turnstile alone is not bot defence; server rate limits remain. Egypt-specific legal review (consumer protection, Personal Data Protection Law, invoicing/tax, returns) required before launch; generated policy text is draft only.
