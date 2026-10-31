# Deployment and environments

Status after Phase 3: runs locally in `workerd` against a local PostgreSQL and a local R2 simulation. **Nothing is deployed.** Cloud resources below do not exist yet and need an account owner's approval and real credentials.

## Resources per environment

| Resource | Dev (local) | Staging | Production |
|---|---|---|---|
| Worker | `npm run dev` | `shrouk-eyewear-staging` | `shrouk-eyewear-production` |
| PostgreSQL | embedded server, `shrouk_dev` / `shrouk_test` (`npm run db:dev`) | managed, separate database and credentials | managed, PITR enabled, separate credentials |
| Hyperdrive (no cache) `HYPERDRIVE` | `localConnectionString` in `wrangler.jsonc` | one config, caching off | one config, caching off |
| Hyperdrive (cached) `HYPERDRIVE_CATALOG` | same local string | one config, caching on | one config, caching on |
| R2 `MEDIA` | local simulation | `shrouk-media-staging` | `shrouk-media-production` |
| Secrets | `.dev.vars` (gitignored) | `wrangler secret put --env staging` | `wrangler secret put --env production` |

IDs in `wrangler.jsonc` under `env.staging` and `env.production` are placeholders (`REPLACE_WITH_…`) and make a deploy fail on purpose until real resources are created.

## Binding policy

- `HYPERDRIVE` (cache disabled) is the default. It is used for sessions, permissions, cart, checkout, inventory, payments, audit and every admin read and write, because those need read-after-write correctness.
- `HYPERDRIVE_CATALOG` (cache enabled) is only used by public storefront loaders for published catalog reads, where a short delay is acceptable. In code this is `RequestScope.catalogDb`; admin code never uses it, so an edit is visible in the admin immediately even if the public page lags.
- Never read stock, price validation or payment state through the cached binding (rule for Phases 4 and 5).

## Secrets (never in git)

| Name | Purpose | Generate |
|---|---|---|
| `SESSION_SECRET` | HMAC key for CSRF tokens | 32+ random bytes, base64url |
| `MFA_ENCRYPTION_KEY` | AES-256-GCM key for TOTP secrets at rest | exactly 32 random bytes, base64 |

Later phases add Paymob keys and HMAC secret, Turnstile secret, email provider key. Rotating `MFA_ENCRYPTION_KEY` requires re-encrypting stored secrets (or forcing re-enrolment); plan this before launch.

## Database roles (to create when the managed database exists)

- `shrouk_migrator`: owner, used only by the CI migration step (`drizzle-kit migrate`).
- `shrouk_app`: `SELECT, INSERT, UPDATE, DELETE` on application tables, no DDL. This is the credential Hyperdrive stores.
- Separate databases and credentials per environment; no production credential on a developer machine.

## First-time bring-up (checklist for the account owner)

1. Create managed PostgreSQL (staging first) with automatic backups/PITR; create the two roles.
2. `wrangler hyperdrive create` twice (caching disabled / enabled) for the same database; put the IDs in `wrangler.jsonc`.
3. `wrangler r2 bucket create shrouk-media-<env>`; keep the bucket private (the Worker serves only `products/` keys through `/media/*`).
4. Run migrations: `DATABASE_URL=<migrator url> npm run db:migrate`.
5. Set secrets with `wrangler secret put`.
6. Create the first HQ admin: the dev seed is blocked for non-local databases on purpose; use a one-off script with an explicit approval (Phase 9), or an invite created by a bootstrap command.
7. `wrangler deploy --env staging`, then smoke tests (Phase 9).

## Local commands

```bash
npm run db:dev        # start local PostgreSQL (keep running)
npm run dev:init      # once: creates .dev.vars with random local secrets
npm run db:migrate    # apply migrations to shrouk_dev
npm run db:seed       # roles, demo catalog, demo branches, first HQ admin
npm run dev           # app in workerd on :5173
npm run test:integration && npm run test:e2e
```

The seed admin e-mail and a random password are written to `.dev.vars`. The first login enrols TOTP (shows a setup key; no QR library yet).

## Known gaps (tracked)

No CSP yet (needs nonces; Phase 8). Rate limiting is Postgres-backed per IP/account only; Cloudflare edge rules come in Phase 9. Turnstile is not wired because no site key exists. No password reset or e-mail verification yet (needs the e-mail provider).

## Cron

`wrangler.jsonc` schedules `*/5 * * * *` which runs `expireStaleOrders`. Add the same `triggers.crons` entry under `env.staging` and `env.production` when those environments are created, because only the top-level block is local.

`ENABLE_COD` is a plain variable (`false` by default). Do not set it to `true` in staging or production until the business has approved cash on delivery.

## Payment secrets (Phase 5)

`wrangler secret put` for each environment: `PAYMOB_SECRET_KEY`, `PAYMOB_PUBLIC_KEY`, `PAYMOB_HMAC_SECRET`, `PAYMOB_INTEGRATION_ID`, optionally `PAYMOB_API_KEY`. Use Paymob **test** keys on staging and live keys only on production after the authorised live smoke test. Never set `PAYMOB_BASE_URL` outside local development (the app refuses to start with it).

Paymob must be given `https://<site>/webhooks/paymob` as the processed-callback URL; the intention also sends it per payment. After a release that changes roles run `npm run db:sync-roles`.

## Backup and restore drill

`npm run db:backup-drill` (script `scripts/backup-drill.ts`) exports every public table to NDJSON, restores it into a scratch database built from the checked-in migrations, and compares row counts and a content checksum per table. It exits non-zero on any difference and drops the scratch database afterwards. Last run against the development database: 37 tables, 1181 rows, all identical.

Limits to know:
- The restore step sets `session_replication_role = replica` to load tables in any order, which needs a superuser. It works on the local development database. Managed providers (for example Neon) refuse it for the application role, so run the drill there with an owner/admin connection or restore with the provider's own tools.
- The export holds personal data and password hashes. It is written under `artifacts/` (gitignored) and deleted unless `KEEP_DUMP=1`.
- For production rely on the provider's point-in-time recovery, keep at least 7 days of history, and repeat a restore into a separate project once before launch and after every schema change that touches money tables. Never point the drill at the live database.
