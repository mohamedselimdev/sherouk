import { z } from "zod";

const hyperdrive = z.object({ connectionString: z.string().min(1) });

const envSchema = z.object({
  APP_ENV: z.enum(["development", "staging", "production"]),
  SITE_URL: z.url(),
  /** Cash on delivery stays off until the business approves it. */
  ENABLE_COD: z.enum(["true", "false"]).default("false"),
  /** Paymob merchant credentials. Online payment is enabled only when all four are present. Secrets only: never in git. */
  PAYMOB_SECRET_KEY: z.string().min(8).optional(),
  PAYMOB_PUBLIC_KEY: z.string().min(8).optional(),
  PAYMOB_HMAC_SECRET: z.string().min(8).optional(),
  PAYMOB_INTEGRATION_ID: z
    .string()
    .regex(/^\d{3,12}$/)
    .optional(),
  /** Legacy API key used only for transaction inquiry and refunds. */
  PAYMOB_API_KEY: z.string().min(8).optional(),
  /** Only for local development against a stub; any other environment uses the real Paymob host. */
  PAYMOB_BASE_URL: z.url().optional(),
  SESSION_SECRET: z.string().min(32),
  /** base64 of exactly 32 random bytes. */
  MFA_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 bytes, base64"),
  HYPERDRIVE: hyperdrive,
  HYPERDRIVE_CATALOG: hyperdrive,
  MEDIA: z.custom<R2Bucket>(
    (v) => typeof v === "object" && v !== null && typeof (v as R2Bucket).put === "function",
  ),
});

export type AppEnv = z.infer<typeof envSchema>;

/** Validates runtime configuration; throws with field names only (never values). */
export function parseEnv(raw: Record<string, unknown>): AppEnv {
  const result = envSchema
    .refine((e) => !e.PAYMOB_BASE_URL || e.APP_ENV === "development", {
      message: "PAYMOB_BASE_URL is only allowed in development",
      path: ["PAYMOB_BASE_URL"],
    })
    .safeParse(raw);
  if (!result.success) {
    const fields = result.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment configuration: ${fields}`);
  }
  return result.data;
}
