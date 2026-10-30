import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { computePaymobHmac } from "../../server/payments/paymob";
import { cleanup, loginAsStaff, makeStaff, type TestStaff } from "./support";
import { resetOrdersAndStock } from "./orders-support";
import { startPaymobStub, type StubIntention } from "./paymob-stub";

test.describe.configure({ mode: "serial" });

const HMAC_SECRET = readFileSync(".dev.vars", "utf8")
  .split(/\r?\n/)
  .find((l) => l.startsWith("PAYMOB_HMAC_SECRET="))!
  .slice("PAYMOB_HMAC_SECRET=".length)
  .trim();

let stub: { server: Server; intentions: StubIntention[] };
let support: TestStaff;
let finance: TestStaff;
let txCounter = 5_000_000;

test.beforeAll(async () => {
  await cleanup();
  await resetOrdersAndStock();
  stub = await startPaymobStub();
  support = await makeStaff("pay-support", "customer_support");
  finance = await makeStaff("pay-finance", "finance");
});
test.afterAll(async () => {
  await new Promise((r) => stub.server.close(r));
  await resetOrdersAndStock();
  await cleanup();
});

function callbackObject(
  providerOrderId: number,
  reference: string,
  amount: number,
  extra: Record<string, unknown> = {},
) {
  return {
    id: ++txCounter,
    amount_cents: amount,
    created_at: "2026-10-29T12:00:00.000000",
    currency: "EGP",
    error_occured: false,
    has_parent_transaction: false,
    integration_id: 1234567,
    is_3d_secure: true,
    is_auth: false,
    is_capture: false,
    is_refunded: false,
    is_standalone_payment: true,
    is_voided: false,
    order: { id: providerOrderId, merchant_order_id: reference },
    owner: 302852,
    pending: false,
    source_data: { pan: "2346", sub_type: "MasterCard", type: "card" },
    success: true,
    refunded_amount_cents: 0,
    ...extra,
  };
}

async function postCallback(
  request: APIRequestContext,
  obj: Record<string, unknown>,
  opts: { hmac?: string | null } = {},
) {
  const hmac = opts.hmac === undefined ? await computePaymobHmac(obj, HMAC_SECRET) : opts.hmac;
  const url = hmac === null ? "/webhooks/paymob" : `/webhooks/paymob?hmac=${hmac}`;
  return request.post(url, { data: { type: "TRANSACTION", obj } });
}

/** Each test has a fresh browser, so identify the order the way a guest would: reference + phone, then go to the page. */
async function openOrder(
  page: import("@playwright/test").Page,
  ref: string,
  path: string,
  phone = "01012345678",
) {
  await page.goto(`/en/order/${ref}`);
  await page.waitForSelector("html[data-hydrated]");
  if (await page.getByRole("heading", { name: "Track your order" }).isVisible()) {
    await page.getByLabel("Mobile number used on the order").fill(phone);
    await page.getByRole("button", { name: "View order" }).click();
    await expect(page.getByRole("heading", { name: new RegExp(ref) })).toBeVisible();
  }
  if (path) await page.goto(path);
}

let placed: { ref: string; total: number; intention: StubIntention };

test("online checkout sends the exact amount to the provider and redirects to its hosted page", async ({
  page,
}) => {
  await page.goto("/en/p/classic-sunglasses");
  await page.waitForSelector("html[data-hydrated]");
  await page.getByRole("button", { name: "Add to cart" }).first().click();
  await page.goto("/en/checkout");
  await page.waitForSelector("html[data-hydrated]");
  await page.getByLabel("First name *").fill("E2E Card Buyer");
  await page.getByLabel("Phone number *").fill("01012345678");
  await page.getByLabel("Governorate *").selectOption("cairo");
  await page.getByLabel("City / area *").fill("Nasr City");
  await page.getByLabel("Street address *").fill("12 Test Street, Apt 4");
  await page.getByText("Pay by card", { exact: true }).click();
  await page.getByRole("button", { name: "Place order" }).click();

  await expect(page).toHaveURL(
    /^http:\/\/127.0.0.1:5199\/unifiedcheckout\/\?publicKey=pk_test_local_only&clientSecret=cs_local_/,
  );
  const intention = stub.intentions.at(-1)!;
  expect(intention.authorization).toBe("Token sk_test_local_only");
  expect(intention.body.amount).toBe(252000);
  expect(intention.body.currency).toBe("EGP");
  const ref = String(intention.body.special_reference).replace(/-1$/, "");
  expect(ref).toMatch(/^SH-[A-Z0-9]{8}$/);
  expect(String(intention.body.notification_url)).toBe("http://localhost:5173/webhooks/paymob");
  expect(String(intention.body.redirection_url)).toBe(`http://localhost:5173/en/checkout/result/${ref}`);
  expect(JSON.stringify(intention.body)).not.toContain("sk_test_local_only");
  placed = { ref, total: 252000, intention };

  // Returning from the provider proves nothing: whatever the query says, the order stays unpaid until a verified webhook.
  await page.goto(`/en/checkout/result/${ref}?success=true&pending=false`);
  await expect(
    page.getByRole("status").filter({ hasText: "Waiting for the payment provider" }),
  ).toBeVisible();
  await expect(page.getByText("Unpaid", { exact: true })).toBeVisible();
});

test("the webhook rejects missing, wrong and tampered signatures and never changes the order", async ({
  request,
}) => {
  const obj = callbackObject(placed.intention.providerOrderId, `${placed.ref}-1`, placed.total);
  expect((await postCallback(request, obj, { hmac: null })).status()).toBe(401);
  expect((await postCallback(request, obj, { hmac: "0".repeat(128) })).status()).toBe(401);
  expect((await postCallback(request, obj, { hmac: "short" })).status()).toBe(401);
  const signed = await computePaymobHmac(obj, HMAC_SECRET);
  expect((await postCallback(request, { ...obj, amount_cents: 1 }, { hmac: signed })).status()).toBe(401);
  expect((await postCallback(request, { ...obj, success: false }, { hmac: signed })).status()).toBe(401);
  expect((await request.get("/webhooks/paymob")).status()).toBe(405);
  expect(
    (
      await request.post(`/webhooks/paymob?hmac=${signed}`, {
        data: "not json",
        headers: { "content-type": "text/plain" },
      })
    ).status(),
  ).toBe(400);
});

test("a correctly signed callback with the wrong amount is recorded but pays nothing", async ({
  request,
  page,
}) => {
  const obj = callbackObject(placed.intention.providerOrderId, `${placed.ref}-1`, placed.total - 1);
  const res = await postCallback(request, obj);
  expect(res.status()).toBe(200);
  expect((await res.json()).outcome).toBe("amount_mismatch");
  await openOrder(page, placed.ref, "");
  await expect(page.getByText("Unpaid", { exact: true })).toBeVisible();
});

test("a verified success pays the order; replays and a late failure change nothing; the result page confirms it", async ({
  request,
  page,
}) => {
  const obj = callbackObject(placed.intention.providerOrderId, `${placed.ref}-1`, placed.total);
  const first = await postCallback(request, obj);
  expect((await first.json()).outcome).toBe("paid");
  const again = await postCallback(request, obj);
  expect((await again.json()).outcome).toBe("duplicate");
  const late = await postCallback(
    request,
    callbackObject(placed.intention.providerOrderId, `${placed.ref}-1`, placed.total, { success: false }),
  );
  expect((await late.json()).outcome).toBe("ignored_after_paid");

  await openOrder(page, placed.ref, `/en/checkout/result/${placed.ref}`);
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
  await expect(page.getByText("Paid", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pay now" })).toHaveCount(0);
});

test("refund workflow: support requests, finance approves, an unconfigured provider fails safely, a provider callback records it", async ({
  page,
  request,
}) => {
  await loginAsStaff(page, support);
  await page.goto("/en/admin/orders");
  await page.locator("main ul li a", { hasText: placed.ref }).click();
  await expect(page.getByText("Net ledger amount: EGP 2,520")).toBeVisible();
  await page.getByLabel("Amount (EGP)").fill("100");
  await page.getByLabel("Refund reason").fill("Customer returned the lenses");
  await page.getByRole("button", { name: "Request a refund" }).click();
  await expect(page.getByText("Requested", { exact: true })).toBeVisible();
  // Support cannot approve.
  await expect(page.getByRole("button", { name: "Approve and execute" })).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out" }).click();

  await loginAsStaff(page, finance);
  await page.goto("/en/admin/orders");
  await page.locator("main ul li a", { hasText: placed.ref }).click();
  await page.getByRole("button", { name: "Approve and execute" }).click();
  // No API key is configured locally, so execution fails safely and no money is recorded.
  await expect(page.getByRole("alert").filter({ hasText: "Refund not possible" })).toBeVisible();
  await expect(page.getByText("Net ledger amount: EGP 2,520")).toBeVisible();

  // The provider later reports a 100 EGP refund (e.g. done in its dashboard): recorded exactly once.
  const refundCallback = callbackObject(placed.intention.providerOrderId, `${placed.ref}-1`, placed.total, {
    is_refunded: true,
    refunded_amount_cents: 10000,
  });
  expect((await (await postCallback(request, refundCallback)).json()).outcome).toBe("refund_recorded");
  expect((await (await postCallback(request, refundCallback)).json()).outcome).toBe("duplicate");
  await page.reload();
  await expect(page.getByText("Net ledger amount: EGP 2,420")).toBeVisible();
});

test("failed card attempt then retry from the order page starts a second attempt", async ({ page }) => {
  await page.goto("/en/p/silver-aviator");
  await page.waitForSelector("html[data-hydrated]");
  await page.getByRole("button", { name: "Add to cart" }).first().click();
  await page.goto("/en/checkout");
  await page.waitForSelector("html[data-hydrated]");
  await page.getByLabel("First name *").fill("E2E Retry Buyer");
  await page.getByLabel("Phone number *").fill("01112345678");
  await page.getByText("Pick up from a branch", { exact: true }).click();
  await page.getByText("Pay by card", { exact: true }).click();
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page).toHaveURL(/127.0.0.1:5199\/unifiedcheckout/);
  const ref = String(stub.intentions.at(-1)!.body.special_reference).replace(/-1$/, "");
  await page.goto(`/en/order/${ref}`);
  await expect(page.getByRole("button", { name: "Pay now" })).toBeVisible();
  await page.getByRole("button", { name: "Pay now" }).click();
  await expect(page).toHaveURL(/127.0.0.1:5199\/unifiedcheckout/);
  expect(String(stub.intentions.at(-1)!.body.special_reference)).toBe(`${ref}-2`);
});
