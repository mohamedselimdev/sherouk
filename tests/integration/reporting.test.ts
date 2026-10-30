import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { loadPrincipal } from "../../server/auth/rbac";
import {
  advanceFulfillment,
  cancelOrder,
  createOrder,
  markOrderPaid,
  recordCodCollection,
} from "../../server/orders/service";
import { approveRefund, requestRefund } from "../../server/payments/service";
import { overview } from "../../server/reporting/overview";
import { closeDb, db, makeStaff, reset } from "./helpers";
import { deliveryOrder, makeOnlineBranch, makeVariant, rate, stock } from "./commerce-helpers";

beforeEach(async () => {
  await reset();
  await rate("cairo", 0);
});
afterAll(closeDb);

async function world() {
  const a = await makeOnlineBranch("a-branch");
  const b = await makeOnlineBranch("b-branch", { online: false, pickup: true });
  const v = await makeVariant(100000);
  const w = await makeVariant(50000);
  await stock(a, v, 10);
  await stock(a, w, 2); // low stock
  await stock(b, v, 10);

  const hq = await loadPrincipal(db, await makeStaff("hq@shrouk.test", "hq_admin"));
  const finance = await loadPrincipal(db, await makeStaff("fin@shrouk.test", "finance"));
  const mgrA = await loadPrincipal(db, await makeStaff("ma@shrouk.test", "branch_manager", a));
  const mgrB = await loadPrincipal(db, await makeStaff("mb@shrouk.test", "branch_manager", b));
  const marketing = await loadPrincipal(db, await makeStaff("mk@shrouk.test", "marketing"));

  // A: online order, paid, then a partial refund of 20,000.
  const o1 = await createOrder(db, deliveryOrder(v, 2), { allowCod: true });
  await markOrderPaid(db, o1.ref, { type: "provider", providerRef: "tx-1" });
  // A: COD order delivered and collected.
  const o2 = await createOrder(db, deliveryOrder(w, 1, { paymentMethod: "cod" }), { allowCod: true });
  await advanceFulfillment(db, mgrA, o2.ref, "packing");
  await advanceFulfillment(db, mgrA, o2.ref, "shipped");
  await advanceFulfillment(db, mgrA, o2.ref, "delivered");
  await recordCodCollection(db, mgrA, o2.ref);
  // B: pickup order, still unpaid.
  const o3 = await createOrder(db, deliveryOrder(v, 1, { delivery: { method: "pickup", branchId: b } }), {
    allowCod: true,
  });
  // A: cancelled order (must not count).
  const o4 = await createOrder(db, deliveryOrder(v, 1), { allowCod: true });
  await cancelOrder(db, o4.ref, { type: "system" }, "test");

  const support = await loadPrincipal(db, await makeStaff("sup@shrouk.test", "customer_support"));
  const refund = await requestRefund(db, support, o1.ref, 20000, "partial");
  await approveRefund(db, finance, refund.id, null).catch(() => null); // card refund without a provider fails safely
  return { a, b, hq, finance, mgrA, mgrB, marketing, o1, o2, o3 };
}

describe("overview report", () => {
  it("computes real figures from orders and the ledger", async () => {
    const { hq } = await world();
    const o = (await overview(db, hq, { days: 7, locale: "en" }))!;
    expect(o.coverage).toBe("online");
    expect(o.kpis.grossPiasters).toBe(200000 + 50000); // paid online order + collected COD
    expect(o.kpis.refundsPiasters).toBe(20000); // an approved refund with no provider attempt on record is a manual refund
    expect(o.kpis.netRevenuePiasters).toBe(230000);
    expect(o.kpis.orders).toBe(3); // cancelled order excluded
    expect(o.kpis.paidOrders).toBe(2);
    expect(o.kpis.averageOrderPiasters).toBe(125000);
    expect(o.kpis.unitsSold).toBe(3); // 2 + 1 confirmed units; the unpaid pickup is not sold yet
    expect(o.series).toHaveLength(7);
    expect(o.series.reduce((n, d) => n + d.orders, 0)).toBe(3);
    expect(o.series.reduce((n, d) => n + d.revenuePiasters, 0)).toBe(230000);
    expect(o.topProducts[0]).toMatchObject({ units: 2 });
    expect(o.branches.map((b) => b.orders).sort()).toEqual([1, 2]);
    expect(o.lowStock.some((l) => l.available <= 3)).toBe(true);
    expect(o.recentOrders.length).toBeGreaterThan(0);
  });

  it("limits a branch manager to their own branch", async () => {
    const { mgrA, mgrB, a, b } = await world();
    const ra = (await overview(db, mgrA, { days: 7 }))!;
    expect(ra.kpis.orders).toBe(2);
    expect(ra.kpis.grossPiasters).toBe(250000);
    expect(ra.branches.map((x) => x.branchId)).toEqual([a]);
    const rb = (await overview(db, mgrB, { days: 7 }))!;
    expect(rb.kpis.orders).toBe(1);
    expect(rb.kpis.grossPiasters).toBe(0);
    expect(rb.branches.map((x) => x.branchId)).toEqual([b]);
    expect(rb.recentOrders.every((o) => o.ref)).toBe(true);
  });

  it("returns nothing to roles without order access", async () => {
    const { marketing } = await world();
    expect(await overview(db, marketing)).toBeNull();
  });

  it("reflects a recorded refund in net revenue", async () => {
    const { hq, o1 } = await world();
    const { handleProviderEvent } = await import("../../server/payments/service");
    const { paymentAttempts } = await import("../../db/schema");
    const { eq } = await import("drizzle-orm");
    const { orders } = await import("../../db/schema");
    const [order] = await db.select().from(orders).where(eq(orders.ref, o1.ref));
    await db.insert(paymentAttempts).values({
      orderId: order!.id,
      specialReference: `${o1.ref}-9`,
      providerOrderId: "po-report",
      amountPiasters: order!.totalPiasters,
      status: "paid",
    });
    await handleProviderEvent(db, {
      provider: "paymob",
      transactionId: "9001",
      providerOrderId: "po-report",
      merchantReference: null,
      amountPiasters: order!.totalPiasters,
      currency: "EGP",
      success: true,
      pending: false,
      errorOccurred: false,
      isVoided: false,
      isRefunded: true,
      isCaptured: false,
      refundedAmountPiasters: 30000,
      payload: {},
    });
    const o = (await overview(db, hq, { days: 7 }))!;
    // 20,000 was already refunded manually; the provider reports 30,000 cumulative, so only 10,000 is new.
    expect(o.kpis.refundsPiasters).toBe(30000);
    expect(o.kpis.netRevenuePiasters).toBe(250000 - 30000);
  });
});
