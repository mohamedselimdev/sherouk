import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ZodError } from "zod";
import {
  auditEntries,
  branches,
  couponRedemptions,
  coupons,
  orderLines,
  orders,
  productVariants,
  stockMovements,
  stockReservations,
} from "../../db/schema";
import { ForbiddenError, loadPrincipal } from "../../server/auth/rbac";
import {
  adjustStock,
  NegativeStockError,
  OutOfStockError,
  reconcileLedger,
} from "../../server/inventory/service";
import { InvalidTransition } from "../../server/orders/state";
import {
  advanceFulfillment,
  cancelOrder,
  createOrder,
  expireStaleOrders,
  getOrderForCustomer,
  listOrders,
  markOrderPaid,
  quoteOrder,
  recordCodCollection,
} from "../../server/orders/service";
import { closeDb, db, makeStaff, reset } from "./helpers";
import {
  coupon,
  deliveryOrder,
  inventoryOf,
  makeOnlineBranch,
  makeVariant,
  rate,
  stock,
} from "./commerce-helpers";

beforeEach(async () => {
  await reset();
  await rate("cairo", 7000);
});
afterAll(closeDb);

const allowCod = { allowCod: true };
const noCod = { allowCod: false };

async function scenario(price = 100000, onHand = 5) {
  const branch = await makeOnlineBranch("main");
  const variant = await makeVariant(price);
  await stock(branch, variant, onHand);
  return { branch, variant };
}

describe("creating an order", () => {
  it("prices on the server, snapshots lines, holds stock and sets an expiry", async () => {
    const { branch, variant } = await scenario(245000, 5);
    const created = await createOrder(db, deliveryOrder(variant, 2), noCod);
    expect(created.status).toBe("pending_payment");
    expect(created.totalPiasters).toBe(2 * 245000 + 7000);
    expect(created.ref).toMatch(/^SH-[A-Z2-9]{8}$/);

    const [o] = await db.select().from(orders).where(eq(orders.id, created.id));
    expect(o).toMatchObject({
      subtotalPiasters: 490000,
      discountPiasters: 0,
      shippingPiasters: 7000,
      taxPiasters: 0,
      paymentStatus: "unpaid",
      fulfillmentStatus: "unfulfilled",
      branchId: branch,
      contactPhone: "+201012345678",
    });
    expect(o!.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 25 * 60_000);
    const inv = await inventoryOf(branch, variant);
    expect(inv).toMatchObject({ onHand: 5, reserved: 2 });
    const res = await db.select().from(stockReservations).where(eq(stockReservations.orderId, created.id));
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ status: "active", quantity: 2 });
  });

  it("totals are reproducible: a quote equals the order, and the same cart always gives the same total", async () => {
    const { variant } = await scenario(199900, 10);
    await coupon("SAVE10");
    const quote = await quoteOrder(db, {
      lines: [{ variantId: variant, quantity: 3 }],
      governorate: "cairo",
      couponCode: "save10",
      deliveryMethod: "delivery",
    });
    const a = await createOrder(db, deliveryOrder(variant, 3, { couponCode: "SAVE10" }), noCod);
    const b = await createOrder(db, deliveryOrder(variant, 3, { couponCode: "SAVE10" }), noCod);
    expect(a.totalPiasters).toBe(quote.totalPiasters);
    expect(b.totalPiasters).toBe(quote.totalPiasters);
    expect(quote.discountPiasters).toBe(Math.floor((599700 * 1000 + 5000) / 10000));
  });

  it("rejects any client-supplied price, total or discount field", async () => {
    const { variant } = await scenario();
    for (const extra of [{ totalPiasters: 1 }, { discountPiasters: 99999 }, { unitPricePiasters: 1 }]) {
      await expect(createOrder(db, deliveryOrder(variant, 1, extra), noCod)).rejects.toBeInstanceOf(ZodError);
    }
    const tampered = deliveryOrder(variant, 1);
    (tampered.lines[0] as Record<string, unknown>).price = 1;
    await expect(createOrder(db, tampered, noCod)).rejects.toBeInstanceOf(ZodError);
    expect(await db.select().from(orders)).toHaveLength(0);
  });

  it("the order keeps its prices after the catalog price changes", async () => {
    const { variant } = await scenario(100000, 5);
    const first = await createOrder(db, deliveryOrder(variant, 1), noCod);
    await db.update(productVariants).set({ pricePiasters: 150000 }).where(eq(productVariants.id, variant));
    const lines = await db.select().from(orderLines).where(eq(orderLines.orderId, first.id));
    expect(lines[0]!.unitPricePiasters).toBe(100000);
    const second = await createOrder(db, deliveryOrder(variant, 1), noCod);
    expect(second.totalPiasters).toBe(157000);
  });

  it("free shipping above the threshold, none for pickup", async () => {
    const { variant, branch } = await scenario(500000, 5);
    await rate("giza", 9000, 400000);
    const free = await createOrder(
      db,
      deliveryOrder(variant, 1, {
        delivery: { method: "delivery", governorate: "giza", city: "Dokki", address: "5 Nile Street" },
      }),
      noCod,
    );
    expect(free.totalPiasters).toBe(500000);
    await db.update(branches).set({ pickupEnabled: true }).where(eq(branches.id, branch));
    const pickup = await createOrder(
      db,
      deliveryOrder(variant, 1, { delivery: { method: "pickup", branchId: branch } }),
      noCod,
    );
    expect(pickup.totalPiasters).toBe(500000);
  });
});

describe("invalid orders fail safely and leave nothing behind", () => {
  it("rejects bad input", async () => {
    const { variant } = await scenario();
    const bad: [string, Record<string, unknown>][] = [
      ["bad phone", { contact: { name: "A B", phone: "123" } }],
      [
        "bad governorate",
        {
          delivery: {
            method: "delivery",
            governorate: "atlantis",
            city: "x",
            address: "long enough address",
          },
        },
      ],
      ["short key", { idempotencyKey: "short" }],
      ["no lines", { lines: [] }],
      ["quantity 0", { lines: [{ variantId: variant, quantity: 0 }] }],
      ["quantity 11", { lines: [{ variantId: variant, quantity: 11 }] }],
      ["bad payment method", { paymentMethod: "bitcoin" }],
    ];
    for (const [label, extra] of bad)
      await expect(createOrder(db, deliveryOrder(variant, 1, extra), noCod), label).rejects.toBeInstanceOf(
        ZodError,
      );
    expect(await db.select().from(orders)).toHaveLength(0);
  });

  it("rejects unavailable products, duplicate-line overflow, missing rates, non-pickup branches and disabled COD", async () => {
    const { variant, branch } = await scenario();
    const draft = await makeVariant(1000, { status: "draft" });
    const archived = await makeVariant(1000, { archivedVariant: true });
    await stock(branch, draft, 5);
    await stock(branch, archived, 5);
    await expect(createOrder(db, deliveryOrder(draft), noCod)).rejects.toMatchObject({ code: "unavailable" });
    await expect(createOrder(db, deliveryOrder(archived), noCod)).rejects.toMatchObject({
      code: "unavailable",
    });
    await expect(
      createOrder(db, deliveryOrder("00000000-0000-4000-8000-000000000000"), noCod),
    ).rejects.toMatchObject({ code: "unavailable" });
    await expect(
      createOrder(
        db,
        {
          ...deliveryOrder(variant),
          lines: [
            { variantId: variant, quantity: 6 },
            { variantId: variant, quantity: 6 },
          ],
        },
        noCod,
      ),
    ).rejects.toMatchObject({ code: "quantity" });
    await expect(
      createOrder(
        db,
        deliveryOrder(variant, 1, {
          delivery: { method: "delivery", governorate: "luxor", city: "x", address: "long enough address" },
        }),
        noCod,
      ),
    ).rejects.toMatchObject({ code: "shipping" });
    await expect(
      createOrder(db, deliveryOrder(variant, 1, { delivery: { method: "pickup", branchId: branch } }), noCod),
    ).rejects.toMatchObject({ code: "pickup" });
    await expect(
      createOrder(db, deliveryOrder(variant, 1, { paymentMethod: "cod" }), noCod),
    ).rejects.toMatchObject({ code: "payment_method" });
    expect(await db.select().from(orders)).toHaveLength(0);
    expect((await inventoryOf(branch, variant)).reserved).toBe(0);
  });

  it("out of stock rolls everything back (stock, reservations, coupon counter, order)", async () => {
    const { variant, branch } = await scenario(100000, 2);
    const couponId = await coupon("ONCE", { maxRedemptions: 5 });
    await expect(
      createOrder(db, deliveryOrder(variant, 3, { couponCode: "ONCE" }), noCod),
    ).rejects.toBeInstanceOf(OutOfStockError);
    expect(await db.select().from(orders)).toHaveLength(0);
    expect(await db.select().from(stockReservations)).toHaveLength(0);
    expect((await inventoryOf(branch, variant)).reserved).toBe(0);
    const [c] = await db.select().from(coupons).where(eq(coupons.id, couponId));
    expect(c!.redeemedCount).toBe(0);
  });

  it("a multi-line order is all-or-nothing", async () => {
    const branch = await makeOnlineBranch("main");
    const a = await makeVariant(1000);
    const b = await makeVariant(1000);
    await stock(branch, a, 5);
    await stock(branch, b, 1);
    const input = deliveryOrder(a, 2);
    input.lines.push({ variantId: b, quantity: 2 });
    await expect(createOrder(db, input, noCod)).rejects.toBeInstanceOf(OutOfStockError);
    expect((await inventoryOf(branch, a)).reserved).toBe(0);
    expect((await inventoryOf(branch, b)).reserved).toBe(0);
  });

  it("allocates the whole order to one branch that can hold it", async () => {
    const small = await makeOnlineBranch("a-small");
    const big = await makeOnlineBranch("b-big");
    const variant = await makeVariant(1000);
    await stock(small, variant, 1);
    await stock(big, variant, 5);
    const created = await createOrder(db, deliveryOrder(variant, 3), noCod);
    const [o] = await db.select().from(orders).where(eq(orders.id, created.id));
    expect(o!.branchId).toBe(big);
    expect((await inventoryOf(small, variant)).reserved).toBe(0);
    expect((await inventoryOf(big, variant)).reserved).toBe(3);
  });
});

describe("concurrency", () => {
  it("the last unit goes to exactly one of many simultaneous buyers", async () => {
    const { variant, branch } = await scenario(100000, 1);
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () => createOrder(db, deliveryOrder(variant, 1), noCod)),
    );
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(11);
    for (const f of failed) expect(f.reason).toBeInstanceOf(OutOfStockError);
    expect(await inventoryOf(branch, variant)).toMatchObject({ onHand: 1, reserved: 1 });
    expect(await db.select().from(orders)).toHaveLength(1);
  });

  it("never sells more than the stock under heavy contention", async () => {
    const { variant, branch } = await scenario(100000, 5);
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => createOrder(db, deliveryOrder(variant, 1), noCod)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    expect(await inventoryOf(branch, variant)).toMatchObject({ onHand: 5, reserved: 5 });
  });

  it("opposite line orders do not deadlock", async () => {
    const branch = await makeOnlineBranch("main");
    const a = await makeVariant(1000);
    const b = await makeVariant(1000);
    await stock(branch, a, 10);
    await stock(branch, b, 10);
    const forward = () => ({
      ...deliveryOrder(a, 1),
      lines: [
        { variantId: a, quantity: 1 },
        { variantId: b, quantity: 1 },
      ],
    });
    const backward = () => ({
      ...deliveryOrder(a, 1),
      lines: [
        { variantId: b, quantity: 1 },
        { variantId: a, quantity: 1 },
      ],
    });
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => createOrder(db, i % 2 ? forward() : backward(), noCod)),
    );
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(await inventoryOf(branch, a)).toMatchObject({ reserved: 10 });
  });

  it("double submit with the same key creates one order and one hold", async () => {
    const { variant, branch } = await scenario(100000, 5);
    const input = deliveryOrder(variant, 2);
    const results = await Promise.all(Array.from({ length: 8 }, () => createOrder(db, input, noCod)));
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(results.filter((r) => !r.replay)).toHaveLength(1);
    expect(await db.select().from(orders)).toHaveLength(1);
    expect(await inventoryOf(branch, variant)).toMatchObject({ reserved: 2 });
  });

  it("a limited coupon is redeemed no more times than allowed, even concurrently", async () => {
    const { variant } = await scenario(100000, 50);
    const couponId = await coupon("LIMITED", { maxRedemptions: 3 });
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        createOrder(db, deliveryOrder(variant, 1, { couponCode: "LIMITED" }), noCod),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    for (const r of results.filter((x) => x.status === "rejected") as PromiseRejectedResult[])
      expect(r.reason).toMatchObject({ code: "coupon" });
    const [c] = await db.select().from(coupons).where(eq(coupons.id, couponId));
    expect(c!.redeemedCount).toBe(3);
    expect(await db.select().from(couponRedemptions)).toHaveLength(3);
  });
});

describe("coupons", () => {
  it("rejects unknown, inactive, expired, not-started and below-minimum codes", async () => {
    const { variant } = await scenario(100000, 20);
    await coupon("OFF", { active: false });
    await coupon("OLD", { endsAt: new Date(Date.now() - 1000) });
    await coupon("LATER", { startsAt: new Date(Date.now() + 3600_000) });
    await coupon("BIG", { minSubtotalPiasters: 999999 });
    for (const [code, reason] of [
      ["NOPE", "invalid"],
      ["OFF", "invalid"],
      ["OLD", "expired"],
      ["LATER", "not_started"],
      ["BIG", "min_subtotal"],
    ] as const) {
      await expect(
        createOrder(db, deliveryOrder(variant, 1, { couponCode: code }), noCod),
        code,
      ).rejects.toMatchObject({ code: "coupon", message: reason });
    }
  });

  it("codes are case-insensitive and a cancelled order frees its use", async () => {
    const { variant } = await scenario(100000, 20);
    const id = await coupon("Welcome", { maxRedemptions: 1 });
    const o = await createOrder(db, deliveryOrder(variant, 1, { couponCode: "WELCOME" }), noCod);
    await expect(
      createOrder(db, deliveryOrder(variant, 1, { couponCode: "welcome" }), noCod),
    ).rejects.toMatchObject({ code: "coupon" });
    await cancelOrder(db, o.ref, { type: "system" }, "test");
    const [c] = await db.select().from(coupons).where(eq(coupons.id, id));
    expect(c!.redeemedCount).toBe(0);
    await expect(
      createOrder(db, deliveryOrder(variant, 1, { couponCode: "welcome" }), noCod),
    ).resolves.toBeTruthy();
  });
});

describe("payment, expiry and cancellation", () => {
  it("markOrderPaid sells the stock once, confirms the order, and is idempotent", async () => {
    const { variant, branch } = await scenario(100000, 5);
    const o = await createOrder(db, deliveryOrder(variant, 2), noCod);
    expect((await markOrderPaid(db, o.ref, { type: "provider", providerRef: "tx-1" })).outcome).toBe("paid");
    expect((await markOrderPaid(db, o.ref, { type: "provider", providerRef: "tx-1" })).outcome).toBe(
      "already_paid",
    );
    expect(await inventoryOf(branch, variant)).toMatchObject({ onHand: 3, reserved: 0 });
    const [row] = await db.select().from(orders).where(eq(orders.id, o.id));
    expect(row).toMatchObject({ status: "confirmed", paymentStatus: "paid", needsRefund: false });
    const sales = await db.select().from(stockMovements).where(eq(stockMovements.type, "sale"));
    expect(sales).toHaveLength(1);
    expect(sales[0]!.quantity).toBe(-2);
    expect(await reconcileLedger(db)).toEqual([]);
  });

  it("unpaid orders expire: stock comes back, the run is idempotent, paid and fresh orders are untouched", async () => {
    const { variant, branch } = await scenario(100000, 5);
    const stale = await createOrder(db, deliveryOrder(variant, 2), noCod);
    const paid = await createOrder(db, deliveryOrder(variant, 1), noCod);
    const fresh = await createOrder(db, deliveryOrder(variant, 1), noCod);
    await markOrderPaid(db, paid.ref, { type: "provider" });
    await db
      .update(orders)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(orders.id, stale.id));
    await db
      .update(orders)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(orders.id, paid.id));

    expect(await expireStaleOrders(db)).toEqual({ expired: 1 });
    expect(await expireStaleOrders(db)).toEqual({ expired: 0 });
    const [s] = await db.select().from(orders).where(eq(orders.id, stale.id));
    expect(s).toMatchObject({ status: "cancelled", cancelReason: "payment window expired" });
    const [res] = await db.select().from(stockReservations).where(eq(stockReservations.orderId, stale.id));
    expect(res!.status).toBe("expired");
    expect(await inventoryOf(branch, variant)).toMatchObject({ onHand: 4, reserved: 1 });
    const [f] = await db.select().from(orders).where(eq(orders.id, fresh.id));
    expect(f!.status).toBe("pending_payment");
    const [p] = await db.select().from(orders).where(eq(orders.id, paid.id));
    expect(p!.status).toBe("confirmed");
    expect(await reconcileLedger(db)).toEqual([]);
  });

  it("a payment that arrives after expiry reopens the order if the stock is still there", async () => {
    const { variant, branch } = await scenario(100000, 3);
    const o = await createOrder(db, deliveryOrder(variant, 2), noCod);
    await db
      .update(orders)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(orders.id, o.id));
    await expireStaleOrders(db);
    expect((await markOrderPaid(db, o.ref, { type: "provider" })).outcome).toBe(
      "reopened_after_late_payment",
    );
    const [row] = await db.select().from(orders).where(eq(orders.id, o.id));
    expect(row).toMatchObject({
      status: "confirmed",
      paymentStatus: "paid",
      needsRefund: false,
      exception: null,
      cancelledAt: null,
    });
    expect(await inventoryOf(branch, variant)).toMatchObject({ onHand: 1, reserved: 0 });
    expect(await reconcileLedger(db)).toEqual([]);
  });

  it("a late payment with the stock gone is recorded and flagged for a refund, never double-sold", async () => {
    const { variant, branch } = await scenario(100000, 1);
    const o = await createOrder(db, deliveryOrder(variant, 1), noCod);
    await db
      .update(orders)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(orders.id, o.id));
    await expireStaleOrders(db);
    const other = await createOrder(db, deliveryOrder(variant, 1), noCod);
    await markOrderPaid(db, other.ref, { type: "provider" });
    expect((await markOrderPaid(db, o.ref, { type: "provider" })).outcome).toBe("needs_attention");
    const [row] = await db.select().from(orders).where(eq(orders.id, o.id));
    expect(row).toMatchObject({
      status: "cancelled",
      paymentStatus: "paid",
      needsRefund: true,
      exception: "paid_after_cancel_no_stock",
    });
    expect(await inventoryOf(branch, variant)).toMatchObject({ onHand: 0, reserved: 0 });
    expect(await reconcileLedger(db)).toEqual([]);
  });

  it("cancelling an unpaid order releases the hold once; cancelling twice changes nothing", async () => {
    const { variant, branch } = await scenario(100000, 5);
    const o = await createOrder(db, deliveryOrder(variant, 2), noCod);
    expect(await cancelOrder(db, o.ref, { type: "customer" }, "changed mind")).toEqual({ cancelled: true });
    expect(await cancelOrder(db, o.ref, { type: "customer" }, "changed mind")).toEqual({ cancelled: false });
    expect(await inventoryOf(branch, variant)).toMatchObject({ onHand: 5, reserved: 0 });
  });

  it("customers cannot cancel paid orders; staff can, which restocks once and flags the refund", async () => {
    const { variant, branch } = await scenario(100000, 5);
    const admin = await loadPrincipal(db, await makeStaff("a@shrouk.test", "hq_admin"));
    const o = await createOrder(db, deliveryOrder(variant, 2), noCod);
    await markOrderPaid(db, o.ref, { type: "provider" });
    await expect(cancelOrder(db, o.ref, { type: "customer" }, "x")).rejects.toMatchObject({
      code: "forbidden_state",
    });
    await cancelOrder(db, o.ref, { type: "staff", principal: admin }, "customer asked");
    await cancelOrder(db, o.ref, { type: "staff", principal: admin }, "again");
    expect(await inventoryOf(branch, variant)).toMatchObject({ onHand: 5, reserved: 0 });
    const [row] = await db.select().from(orders).where(eq(orders.id, o.id));
    expect(row).toMatchObject({ status: "cancelled", needsRefund: true });
    expect(await reconcileLedger(db)).toEqual([]);
    const log = await db.select().from(auditEntries).where(eq(auditEntries.action, "order.cancelled"));
    expect(log).toHaveLength(1);
  });
});

describe("cash on delivery", () => {
  it("is confirmed and sold at once but never marked paid until the cash is collected after hand-over", async () => {
    const { variant, branch } = await scenario(100000, 5);
    const mgr = await loadPrincipal(db, await makeStaff("m@shrouk.test", "branch_manager", branch));
    const o = await createOrder(db, deliveryOrder(variant, 1, { paymentMethod: "cod" }), allowCod);
    const [row] = await db.select().from(orders).where(eq(orders.id, o.id));
    expect(row).toMatchObject({ status: "confirmed", paymentStatus: "awaiting_collection", expiresAt: null });
    expect(await inventoryOf(branch, variant)).toMatchObject({ onHand: 4, reserved: 0 });
    await expect(recordCodCollection(db, mgr, o.ref)).rejects.toMatchObject({ code: "state" });
    await advanceFulfillment(db, mgr, o.ref, "packing");
    await advanceFulfillment(db, mgr, o.ref, "shipped");
    await expect(recordCodCollection(db, mgr, o.ref)).rejects.toMatchObject({ code: "state" });
    await advanceFulfillment(db, mgr, o.ref, "delivered");
    await recordCodCollection(db, mgr, o.ref);
    const [done] = await db.select().from(orders).where(eq(orders.id, o.id));
    expect(done).toMatchObject({
      status: "completed",
      paymentStatus: "paid",
      fulfillmentStatus: "delivered",
    });
  });

  it("cancelling a COD order before dispatch returns the stock", async () => {
    const { variant, branch } = await scenario(100000, 5);
    const o = await createOrder(db, deliveryOrder(variant, 2, { paymentMethod: "cod" }), allowCod);
    await cancelOrder(db, o.ref, { type: "system" }, "customer called");
    expect(await inventoryOf(branch, variant)).toMatchObject({ onHand: 5, reserved: 0 });
    expect(await reconcileLedger(db)).toEqual([]);
  });
});

describe("fulfilment and access", () => {
  it("enforces legal steps, delivery/pickup rules, and branch scope", async () => {
    const { variant, branch } = await scenario(100000, 5);
    const otherBranch = await makeOnlineBranch("other");
    const mgr = await loadPrincipal(db, await makeStaff("m@shrouk.test", "branch_manager", branch));
    const otherMgr = await loadPrincipal(db, await makeStaff("o@shrouk.test", "branch_manager", otherBranch));
    const o = await createOrder(db, deliveryOrder(variant, 1, { paymentMethod: "cod" }), allowCod);
    await expect(advanceFulfillment(db, otherMgr, o.ref, "packing")).rejects.toBeInstanceOf(ForbiddenError);
    expect(await listOrders(db, otherMgr)).toHaveLength(0);
    expect(await listOrders(db, mgr)).toHaveLength(1);
    await expect(advanceFulfillment(db, mgr, o.ref, "delivered")).rejects.toBeInstanceOf(InvalidTransition);
    await advanceFulfillment(db, mgr, o.ref, "packing");
    await expect(advanceFulfillment(db, mgr, o.ref, "ready_for_pickup")).rejects.toMatchObject({
      code: "state",
    });
    await advanceFulfillment(db, mgr, o.ref, "shipped");
    await expect(cancelOrder(db, o.ref, { type: "staff", principal: mgr }, "late")).rejects.toMatchObject({
      code: "forbidden_state",
    });
  });

  it("customers see an order only with the right reference and phone", async () => {
    const { variant } = await scenario();
    const o = await createOrder(db, deliveryOrder(variant), noCod);
    expect((await getOrderForCustomer(db, o.ref, "010 1234 5678"))?.ref).toBe(o.ref);
    expect((await getOrderForCustomer(db, o.ref.toLowerCase(), "+201012345678"))?.ref).toBe(o.ref);
    expect(await getOrderForCustomer(db, o.ref, "01099999999")).toBeNull();
    expect(await getOrderForCustomer(db, "SH-NOSUCHXX", "01012345678")).toBeNull();
    expect(await getOrderForCustomer(db, o.ref, "garbage")).toBeNull();
  });

  it("the database refuses an order whose total does not add up", async () => {
    const { variant } = await scenario();
    const o = await createOrder(db, deliveryOrder(variant), noCod);
    await expect(db.update(orders).set({ totalPiasters: 1 }).where(eq(orders.id, o.id))).rejects.toThrow();
  });
});

describe("stock adjustments", () => {
  it("need a reason, branch permission, and never break the reserved quantity or go below zero", async () => {
    const { variant, branch } = await scenario(100000, 5);
    const other = await makeOnlineBranch("other");
    const inv = await loadPrincipal(db, await makeStaff("i@shrouk.test", "inventory_staff", branch));
    await createOrder(db, deliveryOrder(variant, 2), noCod);

    await expect(
      adjustStock(db, inv, { branchId: other, variantId: variant, delta: 1, reason: "count" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      adjustStock(db, inv, { branchId: branch, variantId: variant, delta: 1, reason: "" }),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(
      adjustStock(db, inv, { branchId: branch, variantId: variant, delta: 0, reason: "nothing" }),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(
      adjustStock(db, inv, { branchId: branch, variantId: variant, delta: -4, reason: "damaged" }),
    ).rejects.toBeInstanceOf(NegativeStockError);
    await expect(
      adjustStock(db, inv, { branchId: branch, variantId: variant, delta: -3, reason: "damaged" }),
    ).resolves.toEqual({ onHand: 2 });
    await expect(
      adjustStock(db, inv, {
        branchId: branch,
        variantId: variant,
        delta: 10,
        reason: "delivery from supplier",
        type: "receipt",
      }),
    ).resolves.toEqual({ onHand: 12 });
    await expect(
      adjustStock(db, inv, {
        branchId: branch,
        variantId: variant,
        delta: -1,
        reason: "wrong sign",
        type: "receipt",
      }),
    ).rejects.toBeInstanceOf(ZodError);
    expect(await reconcileLedger(db)).toEqual([]);
  });

  it("concurrent adjustments cannot push stock below the reserved quantity", async () => {
    const { variant, branch } = await scenario(100000, 5);
    const admin = await loadPrincipal(db, await makeStaff("a@shrouk.test", "hq_admin"));
    await createOrder(db, deliveryOrder(variant, 3), noCod);
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        adjustStock(db, admin, { branchId: branch, variantId: variant, delta: -1, reason: "shrinkage" }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(await inventoryOf(branch, variant)).toMatchObject({ onHand: 3, reserved: 3 });
  });
});

describe("misc", () => {
  it("every order reference is unique", async () => {
    const { variant } = await scenario(1000, 10);
    const created = await Promise.all(
      Array.from({ length: 10 }, () => createOrder(db, deliveryOrder(variant), noCod)),
    );
    expect(new Set(created.map((c) => c.ref)).size).toBe(10);
  });
});
