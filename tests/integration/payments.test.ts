import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { desc, eq, like } from "drizzle-orm";
import { ledgerEntries, orders, paymentAttempts, paymentEvents, refunds } from "../../db/schema";
import { ForbiddenError, loadPrincipal } from "../../server/auth/rbac";
import {
  advanceFulfillment,
  createOrder,
  expireStaleOrders,
  recordCodCollection,
} from "../../server/orders/service";
import {
  PaymentProviderError,
  type NormalizedEvent,
  type PaymentProvider,
} from "../../server/payments/provider";
import {
  approveRefund,
  handleProviderEvent,
  PaymentStartError,
  reconcilePendingPayments,
  rejectRefund,
  requestRefund,
  startOnlinePayment,
} from "../../server/payments/service";
import { closeDb, db, makeStaff, reset } from "./helpers";
import { deliveryOrder, inventoryOf, makeOnlineBranch, makeVariant, rate, stock } from "./commerce-helpers";

beforeEach(async () => {
  await reset();
  await rate("cairo", 7000);
});
afterAll(closeDb);

let seq = 0;
const URLS = {
  returnUrl: "https://shop.test/en/checkout/result/X",
  notificationUrl: "https://shop.test/webhooks/paymob",
};

function fakeProvider(overrides: Partial<PaymentProvider> = {}): PaymentProvider & { created: unknown[] } {
  const created: unknown[] = [];
  return {
    name: "paymob",
    created,
    async createCheckout(input) {
      created.push(input);
      seq++;
      return {
        intentionId: `int-${seq}`,
        providerOrderId: `po-${seq}`,
        redirectUrl: `https://pay.test/c/${seq}`,
      };
    },
    ...overrides,
  };
}

async function onlineOrder(price = 100000, qty = 1, onHand = 5) {
  const branch = await makeOnlineBranch("main");
  const variant = await makeVariant(price);
  await stock(branch, variant, onHand);
  const order = await createOrder(db, deliveryOrder(variant, qty), { allowCod: false });
  return { branch, variant, order };
}

async function attemptFor(ref: string) {
  const provider = fakeProvider();
  await startOnlinePayment(db, provider, ref, URLS);
  const rows = await db
    .select()
    .from(paymentAttempts)
    .where(like(paymentAttempts.specialReference, `${ref}-%`))
    .orderBy(desc(paymentAttempts.createdAt));
  return { provider, attempt: rows[0]! };
}

let txSeq = 1000;
function event(
  providerOrderId: string,
  amount: number,
  extra: Partial<NormalizedEvent> = {},
): NormalizedEvent {
  return {
    provider: "paymob",
    transactionId: String(++txSeq),
    providerOrderId,
    merchantReference: null,
    amountPiasters: amount,
    currency: "EGP",
    success: true,
    pending: false,
    errorOccurred: false,
    isVoided: false,
    isRefunded: false,
    isCaptured: false,
    refundedAmountPiasters: 0,
    payload: { id: txSeq, amount_cents: amount },
    ...extra,
  };
}

async function getOrder(id: string) {
  const [o] = await db.select().from(orders).where(eq(orders.id, id));
  return o!;
}
const ledgerSum = async (orderId: string) =>
  (await db.select().from(ledgerEntries).where(eq(ledgerEntries.orderId, orderId))).reduce(
    (n, l) => n + l.amountPiasters,
    0,
  );

describe("starting a payment", () => {
  it("creates a numbered attempt for the exact order total and returns the provider URL", async () => {
    const { order } = await onlineOrder(245000, 2);
    const provider = fakeProvider();
    const { redirectUrl } = await startOnlinePayment(db, provider, order.ref, URLS);
    expect(redirectUrl).toMatch(/^https:\/\/pay\.test\/c\//);
    const [a] = await db.select().from(paymentAttempts);
    expect(a).toMatchObject({
      amountPiasters: 497000,
      status: "pending",
      specialReference: `${order.ref}-1`,
      currency: "EGP",
    });
    expect(provider.created[0]).toMatchObject({ reference: `${order.ref}-1`, amountPiasters: 497000 });
    await startOnlinePayment(db, provider, order.ref, URLS);
    expect((await db.select().from(paymentAttempts)).map((x) => x.specialReference).sort()).toEqual([
      `${order.ref}-1`,
      `${order.ref}-2`,
    ]);
  });

  it("a provider failure marks the attempt failed and leaves the order and its stock hold alone", async () => {
    const { order, branch, variant } = await onlineOrder();
    const bad = fakeProvider({
      createCheckout: vi.fn().mockRejectedValue(new PaymentProviderError("down", true)),
    });
    await expect(startOnlinePayment(db, bad, order.ref, URLS)).rejects.toBeInstanceOf(PaymentStartError);
    const [a] = await db.select().from(paymentAttempts);
    expect(a).toMatchObject({ status: "failed", failureReason: "provider_error" });
    expect(await getOrder(order.id)).toMatchObject({ status: "pending_payment", paymentStatus: "unpaid" });
    expect(await inventoryOf(branch, variant)).toMatchObject({ reserved: 1 });
  });

  it("refuses paid, cancelled, expired and cash-on-delivery orders", async () => {
    const { order } = await onlineOrder();
    await db
      .update(orders)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(orders.id, order.id));
    await expect(startOnlinePayment(db, fakeProvider(), order.ref, URLS)).rejects.toMatchObject({
      code: "not_payable",
    });
    await db
      .update(orders)
      .set({ expiresAt: new Date(Date.now() + 60000), paymentStatus: "paid" })
      .where(eq(orders.id, order.id));
    await expect(startOnlinePayment(db, fakeProvider(), order.ref, URLS)).rejects.toMatchObject({
      code: "not_payable",
    });
    const variant = await makeVariant(1000);
    const branch = await makeOnlineBranch("cod-branch");
    await stock(branch, variant, 3);
    const cod = await createOrder(db, deliveryOrder(variant, 1, { paymentMethod: "cod" }), {
      allowCod: true,
    });
    await expect(startOnlinePayment(db, fakeProvider(), cod.ref, URLS)).rejects.toMatchObject({
      code: "not_payable",
    });
  });

  it("createOrder refuses online payment when it is not enabled", async () => {
    const branch = await makeOnlineBranch("main");
    const variant = await makeVariant(1000);
    await stock(branch, variant, 3);
    await expect(
      createOrder(db, deliveryOrder(variant), { allowCod: false, allowOnline: false }),
    ).rejects.toMatchObject({ code: "payment_method" });
  });
});

describe("provider events", () => {
  it("a verified success pays the order, sells the stock and writes one ledger charge", async () => {
    const { order, branch, variant } = await onlineOrder(100000, 2, 5);
    const { attempt } = await attemptFor(order.ref);
    const out = await handleProviderEvent(db, event(attempt.providerOrderId!, order.totalPiasters));
    expect(out).toMatchObject({ outcome: "paid", orderRef: order.ref });
    expect(await getOrder(order.id)).toMatchObject({ status: "confirmed", paymentStatus: "paid" });
    expect(await inventoryOf(branch, variant)).toMatchObject({ onHand: 3, reserved: 0 });
    const [a] = await db.select().from(paymentAttempts);
    expect(a!.status).toBe("paid");
    expect(await ledgerSum(order.id)).toBe(order.totalPiasters);
  });

  it("an identical replay changes nothing", async () => {
    const { order, branch, variant } = await onlineOrder(100000, 1, 5);
    const { attempt } = await attemptFor(order.ref);
    const ev = event(attempt.providerOrderId!, order.totalPiasters);
    expect((await handleProviderEvent(db, ev)).outcome).toBe("paid");
    for (let i = 0; i < 3; i++) expect((await handleProviderEvent(db, { ...ev })).outcome).toBe("duplicate");
    expect(await inventoryOf(branch, variant)).toMatchObject({ onHand: 4, reserved: 0 });
    expect(await db.select().from(ledgerEntries)).toHaveLength(1);
    expect(await db.select().from(paymentEvents)).toHaveLength(1);
  });

  it("concurrent duplicate deliveries are processed once", async () => {
    const { order, branch, variant } = await onlineOrder(100000, 1, 5);
    const { attempt } = await attemptFor(order.ref);
    const ev = event(attempt.providerOrderId!, order.totalPiasters);
    const results = await Promise.all(Array.from({ length: 6 }, () => handleProviderEvent(db, { ...ev })));
    expect(results.filter((r) => r.outcome === "paid")).toHaveLength(1);
    expect(results.filter((r) => r.outcome === "duplicate")).toHaveLength(5);
    expect(await inventoryOf(branch, variant)).toMatchObject({ onHand: 4, reserved: 0 });
    expect(await db.select().from(ledgerEntries)).toHaveLength(1);
  });

  it("wrong amount, wrong currency and unknown orders never move money", async () => {
    const { order } = await onlineOrder(100000, 1, 5);
    const { attempt } = await attemptFor(order.ref);
    expect(
      (await handleProviderEvent(db, event(attempt.providerOrderId!, order.totalPiasters - 1))).outcome,
    ).toBe("amount_mismatch");
    expect(
      (
        await handleProviderEvent(
          db,
          event(attempt.providerOrderId!, order.totalPiasters, { currency: "USD" }),
        )
      ).outcome,
    ).toBe("amount_mismatch");
    expect((await handleProviderEvent(db, event("does-not-exist", order.totalPiasters))).outcome).toBe(
      "unknown_order",
    );
    expect(await getOrder(order.id)).toMatchObject({ status: "pending_payment", paymentStatus: "unpaid" });
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
    expect((await db.select().from(paymentEvents)).map((e) => e.outcome).sort()).toEqual([
      "amount_mismatch",
      "amount_mismatch",
      "unknown_order",
    ]);
  });

  it("pending does nothing; a failure marks the attempt and order payment failed, and a retry can still succeed", async () => {
    const { order } = await onlineOrder(100000, 1, 5);
    const first = await attemptFor(order.ref);
    expect(
      (
        await handleProviderEvent(
          db,
          event(first.attempt.providerOrderId!, order.totalPiasters, { pending: true, success: false }),
        )
      ).outcome,
    ).toBe("pending");
    expect(
      (
        await handleProviderEvent(
          db,
          event(first.attempt.providerOrderId!, order.totalPiasters, { success: false }),
        )
      ).outcome,
    ).toBe("failed");
    expect(await getOrder(order.id)).toMatchObject({ status: "pending_payment", paymentStatus: "failed" });

    const second = await attemptFor(order.ref);
    expect(second.attempt.id).not.toBe(first.attempt.id);
    expect(
      (await handleProviderEvent(db, event(second.attempt.providerOrderId!, order.totalPiasters))).outcome,
    ).toBe("paid");
    expect(await getOrder(order.id)).toMatchObject({ status: "confirmed", paymentStatus: "paid" });
  });

  it("out of order: a failure arriving after a success never un-pays the order", async () => {
    const { order } = await onlineOrder(100000, 1, 5);
    const { attempt } = await attemptFor(order.ref);
    await handleProviderEvent(db, event(attempt.providerOrderId!, order.totalPiasters));
    expect(
      (
        await handleProviderEvent(
          db,
          event(attempt.providerOrderId!, order.totalPiasters, { success: false }),
        )
      ).outcome,
    ).toBe("ignored_after_paid");
    expect(await getOrder(order.id)).toMatchObject({ status: "confirmed", paymentStatus: "paid" });
    expect((await db.select().from(paymentAttempts))[0]!.status).toBe("paid");
  });

  it("a second success for the same attempt (different transaction) does not sell stock twice", async () => {
    const { order, branch, variant } = await onlineOrder(100000, 1, 5);
    const { attempt } = await attemptFor(order.ref);
    await handleProviderEvent(db, event(attempt.providerOrderId!, order.totalPiasters));
    expect(
      (await handleProviderEvent(db, event(attempt.providerOrderId!, order.totalPiasters))).outcome,
    ).toBe("already_paid");
    expect(await inventoryOf(branch, variant)).toMatchObject({ onHand: 4, reserved: 0 });
    expect(await db.select().from(ledgerEntries)).toHaveLength(1);
  });

  it("success after the stock hold expired re-holds and reopens the order; if the stock is gone it flags a refund", async () => {
    const { order, branch, variant } = await onlineOrder(100000, 1, 1);
    const { attempt } = await attemptFor(order.ref);
    await db
      .update(orders)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(orders.id, order.id));
    await expireStaleOrders(db);
    expect((await getOrder(order.id)).status).toBe("cancelled");
    expect(
      (await handleProviderEvent(db, event(attempt.providerOrderId!, order.totalPiasters))).outcome,
    ).toBe("paid");
    expect(await getOrder(order.id)).toMatchObject({
      status: "confirmed",
      paymentStatus: "paid",
      needsRefund: false,
    });
    expect(await inventoryOf(branch, variant)).toMatchObject({ onHand: 0, reserved: 0 });

    // Second customer: their hold expires, someone else buys the last unit, then their payment arrives.
    await stock(branch, variant, 1);
    const late = await createOrder(db, deliveryOrder(variant, 1), { allowCod: false });
    const lateAttempt = await attemptFor(late.ref);
    await db
      .update(orders)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(orders.id, late.id));
    await expireStaleOrders(db);
    const takerOnline = await createOrder(db, deliveryOrder(variant, 1), { allowCod: false });
    const takerAttempt = await attemptFor(takerOnline.ref);
    await handleProviderEvent(db, event(takerAttempt.attempt.providerOrderId!, takerOnline.totalPiasters));
    expect(
      (await handleProviderEvent(db, event(lateAttempt.attempt.providerOrderId!, late.totalPiasters)))
        .outcome,
    ).toBe("paid_needs_attention");
    expect(await getOrder(late.id)).toMatchObject({
      status: "cancelled",
      paymentStatus: "paid",
      needsRefund: true,
    });
  });

  it("stores a sanitised payload only", async () => {
    const { order } = await onlineOrder();
    const { attempt } = await attemptFor(order.ref);
    await handleProviderEvent(
      db,
      event(attempt.providerOrderId!, order.totalPiasters, {
        payload: { id: 1, amount_cents: order.totalPiasters },
      }),
    );
    const [e] = await db.select().from(paymentEvents);
    expect(JSON.stringify(e!.payload)).not.toMatch(/source_data|billing|token|pan/);
  });
});

describe("refunds", () => {
  async function paidOrder() {
    const ctx = await onlineOrder(100000, 2, 5);
    const { attempt } = await attemptFor(ctx.order.ref);
    const paid = event(attempt.providerOrderId!, ctx.order.totalPiasters);
    await handleProviderEvent(db, paid);
    const support = await loadPrincipal(db, await makeStaff("support@shrouk.test", "customer_support"));
    const finance = await loadPrincipal(db, await makeStaff("finance@shrouk.test", "finance"));
    return { ...ctx, attempt, paid, support, finance };
  }

  it("needs a request from one person and approval from another, then executes at the provider and writes the ledger", async () => {
    const { order, support, finance, paid } = await paidOrder();
    const refund = vi.fn(async () => ({ providerRefundId: "rf-1" }));
    const provider = fakeProvider({ refund });
    const { id } = await requestRefund(db, support, order.ref, 50000, "damaged lens");
    await expect(approveRefund(db, support, id, provider)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(rejectRefund(db, support, id, "x")).rejects.toBeInstanceOf(ForbiddenError);
    expect(refund).not.toHaveBeenCalled();
    expect(await approveRefund(db, finance, id, provider)).toEqual({ status: "succeeded" });
    expect(refund).toHaveBeenCalledWith({ transactionId: paid.transactionId, amountPiasters: 50000 });
    expect(await ledgerSum(order.id)).toBe(order.totalPiasters - 50000);
    expect((await getOrder(order.id)).paymentStatus).toBe("paid");
    await expect(approveRefund(db, finance, id, provider)).rejects.toMatchObject({ code: "bad_state" });
  });

  it("the requester cannot approve their own request", async () => {
    const { order, finance } = await paidOrder();
    const hq = await loadPrincipal(db, await makeStaff("hq@shrouk.test", "hq_admin"));
    const { id } = await requestRefund(db, hq, order.ref, 1000, "goodwill");
    await expect(approveRefund(db, hq, id, fakeProvider())).rejects.toMatchObject({ code: "same_person" });
    await expect(
      approveRefund(db, finance, id, fakeProvider({ refund: async () => ({ providerRefundId: "r" }) })),
    ).resolves.toEqual({ status: "succeeded" });
  });

  it("cannot refund more than was paid, unpaid orders, or with no reason; a full refund marks the order refunded", async () => {
    const { order, support, finance } = await paidOrder();
    const provider = fakeProvider({ refund: async () => ({ providerRefundId: "r" }) });
    await expect(
      requestRefund(db, support, order.ref, order.totalPiasters + 1, "too much"),
    ).rejects.toMatchObject({ code: "too_much" });
    await expect(requestRefund(db, support, order.ref, 0, "zero")).rejects.toMatchObject({
      code: "too_much",
    });
    await expect(requestRefund(db, support, order.ref, 100, " ")).rejects.toMatchObject({
      code: "bad_state",
    });
    const a = await requestRefund(db, support, order.ref, 100000, "part 1");
    await expect(
      requestRefund(db, support, order.ref, order.totalPiasters, "all again"),
    ).rejects.toMatchObject({ code: "too_much" });
    await approveRefund(db, finance, a.id, provider);
    const b = await requestRefund(db, support, order.ref, order.totalPiasters - 100000, "rest");
    await approveRefund(db, finance, b.id, provider);
    expect((await getOrder(order.id)).paymentStatus).toBe("refunded");
    expect(await ledgerSum(order.id)).toBe(0);

    const { order: unpaid } = await (async () => {
      const v = await makeVariant(1000);
      const br = await makeOnlineBranch("another");
      await stock(br, v, 2);
      return { order: await createOrder(db, deliveryOrder(v), { allowCod: false }) };
    })();
    await expect(requestRefund(db, support, unpaid.ref, 100, "no payment")).rejects.toMatchObject({
      code: "not_paid",
    });
  });

  it("a provider failure leaves the refund failed and the money untouched", async () => {
    const { order, support, finance } = await paidOrder();
    const { id } = await requestRefund(db, support, order.ref, 1000, "test");
    const provider = fakeProvider({
      refund: async () => {
        throw new PaymentProviderError("declined");
      },
    });
    expect(await approveRefund(db, finance, id, provider)).toEqual({ status: "failed" });
    expect((await db.select().from(refunds))[0]).toMatchObject({ status: "failed" });
    expect(await ledgerSum(order.id)).toBe(order.totalPiasters);
    // Not configured at all behaves the same way.
    const again = await requestRefund(db, support, order.ref, 1000, "again");
    expect(await approveRefund(db, finance, again.id, null)).toEqual({ status: "failed" });
  });

  it("a provider refund callback after our own refund is not counted twice, and a dashboard refund is recorded once", async () => {
    const { order, support, finance, attempt } = await paidOrder();
    const provider = fakeProvider({ refund: async () => ({ providerRefundId: "rf" }) });
    const { id } = await requestRefund(db, support, order.ref, 30000, "ours");
    await approveRefund(db, finance, id, provider);
    const echo = event(attempt.providerOrderId!, order.totalPiasters, {
      isRefunded: true,
      refundedAmountPiasters: 30000,
    });
    expect((await handleProviderEvent(db, echo)).outcome).toBe("refund_ignored");
    expect(await ledgerSum(order.id)).toBe(order.totalPiasters - 30000);

    const dashboard = event(attempt.providerOrderId!, order.totalPiasters, {
      isRefunded: true,
      refundedAmountPiasters: 50000,
    });
    expect((await handleProviderEvent(db, dashboard)).outcome).toBe("refund_recorded");
    expect((await handleProviderEvent(db, { ...dashboard })).outcome).toBe("duplicate");
    expect(await ledgerSum(order.id)).toBe(order.totalPiasters - 50000);
    expect((await db.select().from(refunds)).filter((r) => r.status === "succeeded")).toHaveLength(2);
  });

  it("a void callback for a full payment refunds the order", async () => {
    const { order, attempt } = await paidOrder();
    const voided = event(attempt.providerOrderId!, order.totalPiasters, { isVoided: true });
    expect((await handleProviderEvent(db, voided)).outcome).toBe("refund_recorded");
    expect((await getOrder(order.id)).paymentStatus).toBe("refunded");
    expect(await ledgerSum(order.id)).toBe(0);
  });

  it("cash-on-delivery refunds are recorded as manual, with no provider call", async () => {
    const branch = await makeOnlineBranch("cod");
    const variant = await makeVariant(100000);
    await stock(branch, variant, 3);
    const mgr = await loadPrincipal(db, await makeStaff("m@shrouk.test", "branch_manager", branch));
    const support = await loadPrincipal(db, await makeStaff("s2@shrouk.test", "customer_support"));
    const finance = await loadPrincipal(db, await makeStaff("f2@shrouk.test", "finance"));
    const cod = await createOrder(db, deliveryOrder(variant, 1, { paymentMethod: "cod" }), {
      allowCod: true,
    });
    await advanceFulfillment(db, mgr, cod.ref, "packing");
    await advanceFulfillment(db, mgr, cod.ref, "shipped");
    await advanceFulfillment(db, mgr, cod.ref, "delivered");
    await recordCodCollection(db, mgr, cod.ref);
    expect(await ledgerSum(cod.id)).toBe(cod.totalPiasters);
    const { id } = await requestRefund(db, support, cod.ref, cod.totalPiasters, "returned goods");
    const provider = fakeProvider({ refund: vi.fn() });
    expect(await approveRefund(db, finance, id, provider)).toEqual({ status: "succeeded" });
    expect(provider.refund).not.toHaveBeenCalled();
    expect((await getOrder(cod.id)).paymentStatus).toBe("refunded");
    expect(await ledgerSum(cod.id)).toBe(0);
  });
});

describe("reconciliation", () => {
  it("recovers a payment whose webhook never arrived, once", async () => {
    const { order } = await onlineOrder(100000, 1, 5);
    const { attempt } = await attemptFor(order.ref);
    await db
      .update(paymentAttempts)
      .set({ createdAt: new Date(Date.now() - 30 * 60_000) })
      .where(eq(paymentAttempts.id, attempt.id));
    const inquire = vi.fn(async () => event(attempt.providerOrderId!, order.totalPiasters));
    const provider = fakeProvider({ inquire });
    expect(await reconcilePendingPayments(db, provider)).toEqual({ checked: 1, changed: 1 });
    expect(await getOrder(order.id)).toMatchObject({ status: "confirmed", paymentStatus: "paid" });
    expect(await reconcilePendingPayments(db, provider)).toEqual({ checked: 0, changed: 0 });
    expect(await db.select().from(ledgerEntries)).toHaveLength(1);
  });

  it("ignores recent attempts, unknown results and providers without inquiry; survives provider errors", async () => {
    const { order } = await onlineOrder(100000, 1, 5);
    const { attempt } = await attemptFor(order.ref);
    const inquire = vi.fn(async () => null);
    expect(await reconcilePendingPayments(db, fakeProvider({ inquire }))).toEqual({ checked: 0, changed: 0 });
    await db
      .update(paymentAttempts)
      .set({ createdAt: new Date(Date.now() - 30 * 60_000) })
      .where(eq(paymentAttempts.id, attempt.id));
    expect(await reconcilePendingPayments(db, fakeProvider({ inquire }))).toEqual({ checked: 1, changed: 0 });
    expect(
      await reconcilePendingPayments(
        db,
        fakeProvider({
          inquire: async () => {
            throw new Error("boom");
          },
        }),
      ),
    ).toEqual({ checked: 1, changed: 0 });
    expect(await reconcilePendingPayments(db, fakeProvider())).toEqual({ checked: 0, changed: 0 });
    expect((await getOrder(order.id)).paymentStatus).toBe("unpaid");
  });
});
