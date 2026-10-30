# Backlog, MVP and Phase-2 boundary

## MVP (launchable after Phase 9, subject to business inputs)

Storefront: home, shop/category, product, search, cart, guest + account checkout, order tracking, branch locator, about, blog, contact/FAQ/policies, ar/en, light/dark/system, SEO basics.
Commerce: variants, branch stock + reservations, coupons (simple), shipping by governorate, Paymob cards, optional COD.
Admin: overview, orders/fulfilment, catalog+media, inventory + transfers, branches, customers/support tickets, coupons, CMS blocks + blog, staff/roles/MFA, audit, basic finance report, settings.
Platform: Cloudflare Workers + Hyperdrive + R2 + Queues + Turnstile, CI, staging, runbook.

## Phase-2 (after launch)

Reviews/ratings, wishlist email, abandoned-cart recovery, newsletter segments, lens configurator with pricing rules, appointments (if confirmed), POS API sync, instalments/wallets/Meeza, multi-currency, e-invoicing, loyalty, advanced analytics/attribution, WhatsApp notifications, 3D/try-on (only with real assets).

## Prioritised implementation backlog

| # | Phase | Epic | Exit evidence |
|---|---|---|---|
| 1 | 1 | Scaffold RR8 + Cloudflare plugin, TS strict, Tailwind tokens, i18n routing/RTL, theme, env validation, lint/test/CI, copy kit assets, dev credit footer | typecheck, unit, build green; RTL/LTR + themes at 390/1440 screenshots |
| 2 | 2 | Shell + 9 page recreations with demo-labelled data; admin shell | screenshots 390/1024/1440 vs boards; keyboard pass; overflow checks |
| 3 | 3 | Schema, migrations, seed, auth, sessions, RBAC, audit base, catalog CRUD, R2 upload | clean-DB reproducible; cross-branch denial tests; real products on storefront |
| 4 | 4 | Inventory ledger, reservations, pricing, cart, orders, coupons | concurrency and double-submit tests |
| 5 | 5 | Paymob sandbox, webhook HMAC, reconciliation, COD, fulfilment | webhook test matrix; sandbox evidence |
| 6 | 6 | Full admin modules, reporting from DB | role-by-role scenarios; branch isolation |
| 7 | 7 | CMS, blog, SEO, structured data, consent analytics | rich-results validation, sitemap, consent tests |
| 8 | 8 | Security/perf/a11y/reliability | scans, CWV measurements, restore drill |
| 9 | 9 | Staging deploy, launch checklist, handbook | smoke tests; authorised live test (separate) |

## Risks

Stack versions are new (RR 8, Vite 8, Vitest 5): expect plugin peer issues; mitigated by Phase 1 spike. Workers CPU limits for password hashing and SSR. Brand/legal/photo inputs are the main schedule risk. Scope is very large; each phase ships as a reviewed milestone.
