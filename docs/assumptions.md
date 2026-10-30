# Assumptions, missing inputs, prerequisites

## Missing business inputs (blockers by phase)

| Input | Needed by | Dev default |
|---|---|---|
| Real branch list (count, names, addresses, phones, hours, exam offering) | 2 (labels), 3 | Demo-labelled branches; count computed from DB; boards' "7" provisional |
| Real catalog, SKUs, prices, brands (and permission to display brand names/logos) | 3 | Demo products labelled "DEMO", kit illustrations |
| Product photography, branch photos, licensed campaign imagery | 2/launch | Kit crops/illustrations (not production grade) |
| Legal entity, tax registration, VAT treatment, invoice requirements | 4 | No tax calculation; price display "as entered" |
| Shipping zones, fees, free-shipping threshold, courier(s) | 4 | Configurable flat rate per governorate (placeholder) |
| Return/refund policy text, privacy policy, terms (legal-reviewed) | launch | Draft placeholders marked "pending approval" |
| Paymob merchant account (sandbox then live), integration IDs, HMAC secret | 5 | None — mocked at the adapter interface in tests only; never presented as live |
| Which payment methods Paymob enabled (cards, wallets, Meeza, instalments) | 5 | Cards only in config |
| COD approval and settlement process | 5 | Off by default |
| Email/SMS provider choice and sender domain | 5/7 | Console/log transport in dev |
| Existing POS systems and stock source of truth | 6 | CSV import adapter only |
| Domain name, DNS access, Cloudflare account/plan | 9 | `workers.dev` staging |
| Managed PostgreSQL provider (Neon, Supabase, RDS, etc.) and budget | 3 | Local Postgres in Docker for dev |
| Map provider choice | 2 | OpenStreetMap + Leaflet (no key); Google Maps if business prefers |
| Analytics IDs (GA4, Meta pixel, Search Console, Merchant Center) | 7 | Disabled; adapter test mode |
| Reviews/ratings: do real reviews exist? | 3/Phase 2 | Rating UI hidden |
| About-page facts (history, stats, mission) | 2 | Placeholder content flagged |
| Developer credit | 2 | Footer credit "Developed by" + MS logo linking `https://mohamedselim.dev/ar`, per owner standing instruction |

## Working assumptions

- Currency EGP only; timezone Africa/Cairo; stored UTC.
- Staff language switch ar/en; storefront default Arabic.
- Brand name is only SHROUK / شروق. The kit's source moodboards and some crops reference the earlier placeholder name ("shams"): those files are not copied into the app, and any asset showing it is excluded (kit notes already warn about this).
- `source-moodboards/*` are not licensed for publishing; they stay in `_kit`, outside the build.
- Third-party brand logos on boards are not used until permitted.
- MVP is single-currency, single-region (Egypt), no marketplace, no loyalty, no reviews, no prescription lens configurator (quote/consultation form instead).

## External cost considerations (indicative, verify current pricing)

Cloudflare Workers paid plan (needed for Queues/Hyperdrive limits and higher CPU), R2 storage/ops, managed Postgres (prod + staging, with PITR tier), email/SMS provider, error-monitoring tier, domain, Paymob transaction fees, Turnstile (free). Exact figures are not stated here because they change; confirm at Phase 9 planning.

## Platform caveats to verify in Phase 1

Worker CPU/memory limits for SSR + password hashing; Hyperdrive + chosen Postgres driver in `workerd`; Queues and Cron availability on the chosen plan; Hyperdrive caching configured per binding.
