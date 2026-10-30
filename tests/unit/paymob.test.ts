import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  computePaymobHmac,
  normalizePaymobTransaction,
  PAYMOB_HMAC_FIELDS,
  PaymobProvider,
  paymobHmacString,
  verifyPaymobHmac,
} from "../../server/payments/paymob";
import { PaymentProviderError } from "../../server/payments/provider";

/** The example transaction from Paymob's "HMAC Transaction Callback" documentation. */
const doc = {
  amount_cents: 100000,
  created_at: "2024-06-13T11:33:44.592345",
  currency: "EGP",
  error_occured: false,
  has_parent_transaction: false,
  id: 192036465,
  integration_id: 4097558,
  is_3d_secure: true,
  is_auth: false,
  is_capture: false,
  is_refunded: false,
  is_standalone_payment: true,
  is_voided: false,
  order: { id: 217503754, merchant_order_id: null },
  owner: 302852,
  pending: false,
  source_data: { pan: "2346", sub_type: "MasterCard", type: "card" },
  success: true,
  refunded_amount_cents: 0,
};
const DOC_STRING =
  "1000002024-06-13T11:33:44.592345EGPfalsefalse1920364654097558truefalsefalsefalsetruefalse217503754302852false2346MasterCardcardtrue";
const SECRET = "test-hmac-secret";

describe("paymob hmac", () => {
  it("lists the 20 fields in the documented order", () => {
    expect(PAYMOB_HMAC_FIELDS).toHaveLength(20);
    expect(PAYMOB_HMAC_FIELDS[0]).toBe("amount_cents");
    expect(PAYMOB_HMAC_FIELDS[19]).toBe("success");
  });

  it("builds exactly the string shown in the documentation's example", () => {
    expect(paymobHmacString(doc)).toBe(DOC_STRING);
  });

  it("matches an independent HMAC-SHA512 implementation", async () => {
    const expected = createHmac("sha512", SECRET).update(DOC_STRING).digest("hex");
    expect(await computePaymobHmac(doc, SECRET)).toBe(expected);
    expect(expected).toHaveLength(128);
  });

  it("accepts a correct signature (any hex case) and rejects everything else", async () => {
    const good = createHmac("sha512", SECRET).update(DOC_STRING).digest("hex");
    expect(await verifyPaymobHmac(doc, good, SECRET)).toBe(true);
    expect(await verifyPaymobHmac(doc, good.toUpperCase(), SECRET)).toBe(true);
    expect(await verifyPaymobHmac(doc, good, "other-secret")).toBe(false);
    expect(await verifyPaymobHmac({ ...doc, amount_cents: 1 }, good, SECRET)).toBe(false);
    expect(await verifyPaymobHmac({ ...doc, success: false }, good, SECRET)).toBe(false);
    expect(await verifyPaymobHmac({ ...doc, order: { id: 1 } }, good, SECRET)).toBe(false);
    expect(await verifyPaymobHmac(doc, good.slice(0, 100), SECRET)).toBe(false);
    expect(await verifyPaymobHmac(doc, "z".repeat(128), SECRET)).toBe(false);
    expect(await verifyPaymobHmac(doc, null, SECRET)).toBe(false);
    expect(await verifyPaymobHmac(doc, "", SECRET)).toBe(false);
  });

  it("refuses a callback with a missing required field instead of guessing", async () => {
    const broken: Record<string, unknown> = { ...doc };
    delete broken.currency;
    expect(paymobHmacString(broken)).toBeNull();
    expect(await verifyPaymobHmac(broken, "a".repeat(128), SECRET)).toBe(false);
    expect(paymobHmacString({ ...doc, success: "true" })).toBe(DOC_STRING); // strings are used as sent; type confusion cannot forge a different value
  });

  it("normalises the transaction without keeping card or billing data", () => {
    const ev = normalizePaymobTransaction({
      ...doc,
      billing_data: { phone_number: "010" },
      token: "card-token",
    });
    expect(ev).toMatchObject({
      transactionId: "192036465",
      providerOrderId: "217503754",
      amountPiasters: 100000,
      currency: "EGP",
      success: true,
      pending: false,
    });
    expect(JSON.stringify(ev.payload)).not.toMatch(/card-token|billing|2346|MasterCard/);
  });
});

describe("paymob checkout creation", () => {
  const cfg = {
    secretKey: "sk_test_123",
    publicKey: "pk_test_456",
    hmacSecret: SECRET,
    integrationId: "4097558",
  };
  const request = {
    reference: "SH-ABCDEFGH-1",
    amountPiasters: 252000,
    description: "Order SH-ABCDEFGH",
    customer: { name: "Test Buyer Name", phone: "+201012345678", email: null },
    returnUrl: "https://shop.example/en/checkout/result/SH-ABCDEFGH",
    notificationUrl: "https://shop.example/webhooks/paymob",
  };

  it("sends the exact amount with the secret key and returns the hosted checkout URL", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ id: "int_1", client_secret: "cs_abcdefghijk", intention_order_id: 9001 }),
          { status: 201 },
        ),
    );
    const out = await new PaymobProvider(cfg, fetchMock as unknown as typeof fetch).createCheckout(request);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://accept.paymob.com/v1/intention/");
    expect((init.headers as Record<string, string>).Authorization).toBe("Token sk_test_123");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      amount: 252000,
      currency: "EGP",
      payment_methods: [4097558],
      special_reference: "SH-ABCDEFGH-1",
      notification_url: request.notificationUrl,
      redirection_url: request.returnUrl,
    });
    expect(body.items.reduce((n: number, i: { amount: number }) => n + i.amount, 0)).toBe(body.amount);
    expect(body.billing_data.phone_number).toBe("+201012345678");
    expect(out.providerOrderId).toBe("9001");
    const u = new URL(out.redirectUrl);
    expect(u.origin + u.pathname).toBe("https://accept.paymob.com/unifiedcheckout/");
    expect(u.searchParams.get("publicKey")).toBe("pk_test_456");
    expect(u.searchParams.get("clientSecret")).toBe("cs_abcdefghijk");
    expect(out.redirectUrl).not.toContain("sk_test_123");
  });

  it("maps failures to provider errors without leaking secrets", async () => {
    const make = (impl: () => Promise<Response>) =>
      new PaymobProvider(cfg, impl as unknown as typeof fetch).createCheckout(request);
    await expect(make(async () => new Response("{}", { status: 401 }))).rejects.toMatchObject({
      name: "PaymentProviderError",
      retryable: false,
    });
    await expect(make(async () => new Response("{}", { status: 503 }))).rejects.toMatchObject({
      retryable: true,
    });
    await expect(
      make(async () => {
        throw new Error("socket sk_test_123");
      }),
    ).rejects.toBeInstanceOf(PaymentProviderError);
    await expect(
      make(async () => {
        throw new Error("socket sk_test_123");
      }),
    ).rejects.not.toThrow(/sk_test_123/);
    await expect(
      make(async () => new Response(JSON.stringify({ nope: 1 }), { status: 201 })),
    ).rejects.toBeInstanceOf(PaymentProviderError);
  });
});
