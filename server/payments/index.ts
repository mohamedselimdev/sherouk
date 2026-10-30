import type { AppEnv } from "../env";
import { PaymobProvider } from "./paymob";

/** The online payment provider, or null while the merchant credentials are not configured (online payment stays off). */
export function buildPaymob(
  env: Pick<
    AppEnv,
    | "PAYMOB_SECRET_KEY"
    | "PAYMOB_PUBLIC_KEY"
    | "PAYMOB_HMAC_SECRET"
    | "PAYMOB_INTEGRATION_ID"
    | "PAYMOB_API_KEY"
    | "PAYMOB_BASE_URL"
  >,
): PaymobProvider | null {
  if (
    !env.PAYMOB_SECRET_KEY ||
    !env.PAYMOB_PUBLIC_KEY ||
    !env.PAYMOB_HMAC_SECRET ||
    !env.PAYMOB_INTEGRATION_ID
  )
    return null;
  return new PaymobProvider({
    secretKey: env.PAYMOB_SECRET_KEY,
    publicKey: env.PAYMOB_PUBLIC_KEY,
    hmacSecret: env.PAYMOB_HMAC_SECRET,
    integrationId: env.PAYMOB_INTEGRATION_ID,
    apiKey: env.PAYMOB_API_KEY,
    baseUrl: env.PAYMOB_BASE_URL,
  });
}
