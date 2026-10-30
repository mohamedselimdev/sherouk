/**
 * Creates `.dev.vars` with fresh random local secrets if it does not exist (never overwrites).
 * The file is gitignored. Production secrets are set with `wrangler secret put`, never in files.
 */
import { existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

if (existsSync(".dev.vars")) {
  console.log(".dev.vars already exists; leaving it untouched");
} else {
  const lines = [
    `SESSION_SECRET=${randomBytes(32).toString("base64url")}`,
    `MFA_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`,
    "ENABLE_COD=true",
    // Dummy local values for the Paymob stub used by the end-to-end tests. Real sandbox/live keys go through wrangler secrets.
    "PAYMOB_SECRET_KEY=sk_test_local_only",
    "PAYMOB_PUBLIC_KEY=pk_test_local_only",
    `PAYMOB_HMAC_SECRET=${randomBytes(24).toString("hex")}`,
    "PAYMOB_INTEGRATION_ID=1234567",
    "PAYMOB_BASE_URL=http://127.0.0.1:5199",
    "SEED_ADMIN_EMAIL=admin@shrouk.local",
    `SEED_ADMIN_PASSWORD=${randomBytes(18).toString("base64url")}`,
    "",
  ];
  writeFileSync(".dev.vars", lines.join("\n"), { mode: 0o600 });
  console.log("wrote .dev.vars (local secrets and the seed admin login; see that file)");
}
