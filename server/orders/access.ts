import { hmacHex, safeEqual } from "../security/crypto";
import type { AuthConfig } from "../auth/staff";

/**
 * Guest order access: a signed cookie per order reference, issued right after placing the order or after the
 * reference + phone check. It carries no personal data and cannot be forged without the server secret.
 */
export const orderCookieName = (ref: string) => `shrouk_o_${ref}`;

export function orderAccessToken(cfg: AuthConfig, ref: string): Promise<string> {
  return hmacHex(cfg.sessionSecret, `order-access:${ref}`);
}

export async function verifyOrderAccess(
  cfg: AuthConfig,
  ref: string,
  token: string | undefined,
): Promise<boolean> {
  if (!token) return false;
  return safeEqual(await orderAccessToken(cfg, ref), token);
}
