# Architecture decisions

| ADR | Decision | Reason | Revisit |
|---|---|---|---|
| 001 | Modular monolith on one Worker | One team, one domain; avoids distributed complexity | If load/team size demands |
| 002 | React Router 8 framework mode + Cloudflare Vite plugin | Master prompt; SSR on Workers is officially supported | Phase 1 spike |
| 003 | PostgreSQL + Drizzle via Hyperdrive | Relational integrity, transactions for stock/orders | Driver choice in Phase 1/3 |
| 004 | Two Hyperdrive bindings (no-cache default, cached catalog reads) | Correctness for stock/payment, speed for public catalog | — |
| 005 | Money as integer piasters | No float error | — |
| 006 | Stock via ledger + reserved counter with row-level atomic updates | No oversell, auditability | — |
| 007 | Payment status separate from order and fulfilment status | Independent lifecycles | — |
| 008 | Provider adapters (payments, email, analytics, POS) | Swap providers; testing | — |
| 009 | Server-stored sessions, hashed tokens, HttpOnly cookies; MFA for staff | Revocable, XSS-resistant | Passkeys later |
| 010 | Locale in URL path, translation tables in DB, UI strings in typed dictionaries | SEO, parity | — |
| 011 | Logical CSS properties for RTL/LTR | One stylesheet | — |
| 012 | Kit assets treated as temporary; moodboards excluded from build | Licensing, accuracy | When real photos arrive |
| 013 | Only provider-verified payment methods are rendered | No false promises | After Paymob confirms |
| 014 | No prescription data in MVP | Sensitive data, legal | Phase 2 with legal review |
| 015 | Developer credit lives in shared footer, pinned to one edge | Owner's standing rule | — |
| 016 | Admin lives under `/:lang/admin` and reuses the locale/theme machinery | One routing model, free ar/en switching | If a separate admin host is wanted |
| 017 | Phase 2 cart is a browser-only demo (localStorage); order placement disabled | No fake purchase flow; server cart arrives in Phase 4 | Phase 4 |
| 018 | Map shows a pending notice instead of an embedded map | No map provider approved; avoids third-party tiles before CSP and privacy review | Phase 7 |
| 019 | Passwords hashed with scrypt (N=16384, r=8, p=1) via `node:crypto` under `nodejs_compat`; parameters stored in each hash | Workers cap WebCrypto PBKDF2 at 100k iterations; scrypt runs natively in workerd (verified by the e2e login flow) | Raise cost after load testing |
| 020 | Sessions are server-side rows keyed by SHA-256 of a random cookie token; staff cookie is HttpOnly, SameSite=Strict, Secure on https | Revocable, a DB leak does not leak usable tokens | — |
| 021 | A password-only staff session is `pending`: 10-minute life, no access anywhere until TOTP verifies; every admin loader and action goes through `requireStaff` | No partial sign-in | Passkeys later |
| 022 | Primary keys are random UUIDs (`gen_random_uuid`, v4), not UUIDv7 | PostgreSQL 17 has no native v7; ordering is not needed yet | Revisit with PostgreSQL 18 |
| 023 | Local development uses an embedded real PostgreSQL (`embedded-postgres`, UTF8) instead of Docker | Docker Desktop is not always running; same engine as production | If CI/dev parity issues appear |
| 024 | Storefront read model is bilingual (`name.ar/en`, `slug.ar/en`); the Phase 2 demo cart stores a display snapshot per line | One query serves both locales; locale switch keeps cart names right | Server cart in Phase 4 replaces the snapshot |
| 025 | CSRF: same-origin check plus per-session HMAC token on authenticated actions; the framework also rejects cross-origin actions | Defence in depth with SameSite cookies | — |
| 026 | Fulfilment from a single branch per order (first online branch that can hold every line) | Simple, predictable stock and branch ownership; splitting is Phase 2 scope | If branches regularly lack complete baskets |
| 027 | Cart is a client-side list of variant ids; the server prices it on every quote and at order creation | Guests need no account or server state; no price is ever trusted from the browser | Server cart if abandoned-cart recovery is added |
| 028 | Stock holds use one atomic conditional UPDATE per line plus a pg advisory lock on the idempotency key | Correct under concurrency without table locks (proved by 12- and 20-way tests) | — |
| 029 | COD is behind `ENABLE_COD` (default false) and settles only through an explicit staff collection step | Business approval pending; avoids marking unpaid cash as paid | After COD approval |
| 030 | Webhook events are keyed by transaction id plus its state flags and refunded amount; money moves only through one idempotent handler | Replays are no-ops, a real state change (success, then refund) still applies, any delivery order is safe | — |
| 031 | Refund callbacks are applied as the difference from what the ledger already holds (cumulative semantics) | A refund we executed and its later callback are counted once | Confirm cumulative behaviour in sandbox |
| 032 | Refunds need two people: `refunds:request` (support, operations) and a different `refunds:approve` (finance, HQ) | Four-eyes on money out | Add an amount threshold for a second approver |
| 033 | Online payment turns on only when all four Paymob credentials exist; the base URL override is development-only | A missing secret can never half-enable payments; no production call can be redirected | — |
