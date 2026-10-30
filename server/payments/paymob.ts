import { z } from "zod";
import { safeEqual } from "../security/crypto";
import {
  PaymentProviderError,
  type CheckoutRequest,
  type CheckoutResult,
  type NormalizedEvent,
  type PaymentProvider,
} from "./provider";

export type PaymobConfig = {
  secretKey: string;
  publicKey: string;
  hmacSecret: string;
  integrationId: string;
  /** Legacy API key, only for transaction inquiry and refunds. Optional. */
  apiKey?: string;
  baseUrl?: string;
};

const BASE = "https://accept.paymob.com";

/**
 * Fields concatenated (no separator) for the HMAC of a processed transaction callback, in this exact order.
 * Source: Paymob "HMAC Transaction Callback" documentation (checked in Phase 5). Paths are relative to `obj`,
 * so the docs' `obj.id` is `id` here. Booleans are the strings `true` / `false`.
 */
export const PAYMOB_HMAC_FIELDS = [
  "amount_cents",
  "created_at",
  "currency",
  "error_occured",
  "has_parent_transaction",
  "id",
  "integration_id",
  "is_3d_secure",
  "is_auth",
  "is_capture",
  "is_refunded",
  "is_standalone_payment",
  "is_voided",
  "order.id",
  "owner",
  "pending",
  "source_data.pan",
  "source_data.sub_type",
  "source_data.type",
  "success",
] as const;

function pick(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Returns null when a required scalar is missing, so a malformed callback can never pass verification by accident. */
export function paymobHmacString(obj: unknown): string | null {
  let out = "";
  for (const path of PAYMOB_HMAC_FIELDS) {
    const v = pick(obj, path);
    if (typeof v === "boolean") out += v ? "true" : "false";
    else if (typeof v === "number" || typeof v === "string") out += String(v);
    else if (v === null && path.startsWith("source_data."))
      out += ""; // unknown how Paymob serialises a null here; confirm in sandbox
    else return null;
  }
  return out;
}

async function hmacSha512Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  return Buffer.from(await crypto.subtle.sign("HMAC", key, enc.encode(message))).toString("hex");
}

export async function verifyPaymobHmac(
  obj: unknown,
  receivedHmac: string | null | undefined,
  secret: string,
): Promise<boolean> {
  if (!receivedHmac || !/^[0-9a-fA-F]{128}$/.test(receivedHmac)) return false;
  const str = paymobHmacString(obj);
  if (str === null) return false;
  return safeEqual(await hmacSha512Hex(secret, str), receivedHmac.toLowerCase());
}

export function computePaymobHmac(obj: unknown, secret: string): Promise<string | null> {
  const str = paymobHmacString(obj);
  return str === null ? Promise.resolve(null) : hmacSha512Hex(secret, str);
}

const txObject = z.object({
  id: z.union([z.number(), z.string()]),
  amount_cents: z.number().int(),
  currency: z.string(),
  success: z.boolean(),
  pending: z.boolean(),
  error_occured: z.boolean().default(false),
  is_voided: z.boolean().default(false),
  is_refunded: z.boolean().default(false),
  is_capture: z.boolean().default(false),
  refunded_amount_cents: z.number().int().default(0),
  order: z.object({
    id: z.union([z.number(), z.string()]),
    merchant_order_id: z.union([z.string(), z.number()]).nullish(),
  }),
});

/** Maps a verified processed-callback transaction to the provider-neutral event. Throws on an unexpected shape. */
export function normalizePaymobTransaction(obj: unknown): NormalizedEvent {
  const t = txObject.parse(obj);
  return {
    provider: "paymob",
    transactionId: String(t.id),
    providerOrderId: String(t.order.id),
    merchantReference: t.order.merchant_order_id == null ? null : String(t.order.merchant_order_id),
    amountPiasters: t.amount_cents,
    currency: t.currency,
    success: t.success,
    pending: t.pending,
    errorOccurred: t.error_occured,
    isVoided: t.is_voided,
    isRefunded: t.is_refunded,
    isCaptured: t.is_capture,
    refundedAmountPiasters: t.refunded_amount_cents,
    payload: {
      id: t.id,
      amount_cents: t.amount_cents,
      currency: t.currency,
      success: t.success,
      pending: t.pending,
      error_occured: t.error_occured,
      is_voided: t.is_voided,
      is_refunded: t.is_refunded,
      is_capture: t.is_capture,
      refunded_amount_cents: t.refunded_amount_cents,
      order_id: t.order.id,
      merchant_order_id: t.order.merchant_order_id ?? null,
    },
  };
}

const intentionResponse = z.object({
  client_secret: z.string().min(10),
  id: z.union([z.string(), z.number()]).optional(),
  intention_order_id: z.union([z.string(), z.number()]),
});

export class PaymobProvider implements PaymentProvider {
  readonly name = "paymob";
  private readonly base: string;

  constructor(
    private readonly cfg: PaymobConfig,
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  ) {
    this.base = cfg.baseUrl ?? BASE;
  }

  /** Creates a payment intention for the exact order amount and returns the hosted-checkout redirect URL. */
  async createCheckout(input: CheckoutRequest): Promise<CheckoutResult> {
    const [first, ...rest] = input.customer.name.trim().split(/\s+/);
    const body = {
      amount: input.amountPiasters,
      currency: "EGP",
      payment_methods: [Number(this.cfg.integrationId)],
      // Paymob requires the amount to equal the sum of the item amounts, so the order is sent as one item.
      items: [
        {
          name: input.description.slice(0, 50),
          amount: input.amountPiasters,
          description: input.description.slice(0, 100),
          quantity: 1,
        },
      ],
      billing_data: {
        first_name: first || "NA",
        last_name: rest.join(" ") || "NA",
        email: input.customer.email || "na@example.com",
        phone_number: input.customer.phone,
        apartment: "NA",
        floor: "NA",
        street: "NA",
        building: "NA",
        shipping_method: "NA",
        postal_code: "NA",
        city: "NA",
        country: "EG",
        state: "NA",
      },
      special_reference: input.reference,
      notification_url: input.notificationUrl,
      redirection_url: input.returnUrl,
    };
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}/v1/intention/`, {
        method: "POST",
        headers: { Authorization: `Token ${this.cfg.secretKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new PaymentProviderError("payment provider unreachable", true);
    }
    if (!res.ok)
      throw new PaymentProviderError(
        `payment provider rejected the request (${res.status})`,
        res.status >= 500,
      );
    const parsed = intentionResponse.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new PaymentProviderError("unexpected payment provider response");
    const { client_secret, id, intention_order_id } = parsed.data;
    const url = new URL(`${this.base}/unifiedcheckout/`);
    url.searchParams.set("publicKey", this.cfg.publicKey);
    url.searchParams.set("clientSecret", client_secret);
    return {
      intentionId: String(id ?? intention_order_id),
      providerOrderId: String(intention_order_id),
      redirectUrl: url.toString(),
    };
  }

  private async authToken(): Promise<string> {
    if (!this.cfg.apiKey) throw new PaymentProviderError("PAYMOB_API_KEY is not configured");
    const res = await this.fetchImpl(`${this.base}/api/auth/tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: this.cfg.apiKey }),
      signal: AbortSignal.timeout(15_000),
    });
    const j = (await res.json().catch(() => null)) as { token?: string } | null;
    if (!res.ok || !j?.token)
      throw new PaymentProviderError("payment provider authentication failed", res.status >= 500);
    return j.token;
  }

  /**
   * UNVERIFIED against the official API reference: the legacy inquiry endpoint is taken from third-party material.
   * It is only called when PAYMOB_API_KEY is set and must be confirmed in the Paymob sandbox before relying on it.
   */
  async inquire(ref: { reference: string; providerOrderId: string | null }): Promise<NormalizedEvent | null> {
    const token = await this.authToken();
    const res = await this.fetchImpl(`${this.base}/api/ecommerce/orders/transaction_inquiry`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ merchant_order_id: ref.reference, order_id: ref.providerOrderId }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new PaymentProviderError(`inquiry failed (${res.status})`, res.status >= 500);
    return normalizePaymobTransaction(await res.json());
  }

  /** UNVERIFIED against the official API reference (legacy refund endpoint from third-party material). Sandbox first. */
  async refund(input: {
    transactionId: string;
    amountPiasters: number;
  }): Promise<{ providerRefundId: string }> {
    const token = await this.authToken();
    const res = await this.fetchImpl(`${this.base}/api/acceptance/void_refund/refund`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        auth_token: token,
        transaction_id: Number(input.transactionId),
        amount_cents: input.amountPiasters,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const j = (await res.json().catch(() => null)) as { id?: number | string; success?: boolean } | null;
    if (!res.ok || !j?.id || j.success === false)
      throw new PaymentProviderError(`refund rejected (${res.status})`, res.status >= 500);
    return { providerRefundId: String(j.id) };
  }
}
