# Changelog

## Unreleased
- Phase 0: design audit of nine boards, route map, architecture, ERD and state machines, RBAC matrix, threat model, payment flow, design system, assumptions, backlog, ADRs (`docs/`).

## Phase 1
- Foundation: React Router 8 + Cloudflare Vite plugin, Tailwind tokens, ar/en routing with RTL, light/dark/system theme, env validation, lint/test/CI, shared footer with developer credit.
- Phase 2: storefront pages (home, shop/category, product, cart, checkout UI, branches, about, blog, blog article), admin overview shell, demo data module, demo cart, Playwright overflow/behaviour tests and screenshot capture.
- Phase 3: PostgreSQL schema and first migration (23 tables), Drizzle repositories, staff auth with scrypt, server sessions and mandatory TOTP, invitations, RBAC with branch scoping, audit log, catalog admin (products, variants, prices, media on R2), DB-backed storefront, customer accounts, rate limiting, local dev database, integration and end-to-end tests.
- Phase 4: inventory ledger and reservations, server-side pricing, shipping rates, coupons, order creation with idempotency, order/payment/fulfilment state machines, expiry cron, COD behind a flag, guest order tracking, admin orders and inventory pages, quote API, 38 new integration tests and 8 end-to-end tests.
- Phase 5: payment provider interface and Paymob adapter (intention creation, HMAC-SHA512 verification checked against Paymob's published example), webhook endpoint, idempotent event handler, payment attempts and retry, refunds with four-eyes approval, financial ledger, reconciliation job, order result page, 22 payment integration tests, 8 Paymob unit tests and 6 end-to-end tests against a local stub.
