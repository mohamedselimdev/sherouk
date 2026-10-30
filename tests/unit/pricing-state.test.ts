import { describe, expect, it } from "vitest";
import { computeTotals, couponDiscount, type CouponRule } from "../../server/pricing/totals";
import {
  assertFulfillmentTransition,
  assertOrderTransition,
  assertPaymentTransition,
  FULFILLMENT_TRANSITIONS,
  fulfillmentAllowedFor,
  InvalidTransition,
  ORDER_TRANSITIONS,
  PAYMENT_TRANSITIONS,
} from "../../server/orders/state";
import { GOVERNORATES } from "../../server/fulfillment/governorates";

const pct = (bp: number, extra: Partial<CouponRule> = {}): CouponRule => ({
  type: "percent",
  value: bp,
  minSubtotalPiasters: 0,
  maxDiscountPiasters: null,
  ...extra,
});
const fixed = (v: number, extra: Partial<CouponRule> = {}): CouponRule => ({
  type: "fixed",
  value: v,
  minSubtotalPiasters: 0,
  maxDiscountPiasters: null,
  ...extra,
});

describe("totals", () => {
  it("adds up lines, shipping and no tax", () => {
    const t = computeTotals({
      lines: [
        { unitPricePiasters: 245000, quantity: 2 },
        { unitPricePiasters: 195000, quantity: 1 },
      ],
      shippingPiasters: 7000,
    });
    expect(t).toEqual({
      subtotalPiasters: 685000,
      discountPiasters: 0,
      shippingPiasters: 7000,
      taxPiasters: 0,
      totalPiasters: 692000,
    });
  });

  it("is deterministic and order-independent", () => {
    const a = computeTotals({
      lines: [
        { unitPricePiasters: 1999, quantity: 3 },
        { unitPricePiasters: 50001, quantity: 1 },
      ],
      shippingPiasters: 0,
      coupon: pct(1000),
    });
    const b = computeTotals({
      lines: [
        { unitPricePiasters: 50001, quantity: 1 },
        { unitPricePiasters: 1999, quantity: 3 },
      ],
      shippingPiasters: 0,
      coupon: pct(1000),
    });
    expect(a).toEqual(b);
  });

  it("percent coupons round half up on piasters", () => {
    expect(couponDiscount(1005, pct(1000))).toBe(101); // 100.5 -> 101
    expect(couponDiscount(1004, pct(1000))).toBe(100); // 100.4 -> 100
    expect(couponDiscount(999, pct(5000))).toBe(500); // 499.5 -> 500
  });

  it("applies caps, minimums and never exceeds the subtotal", () => {
    expect(couponDiscount(100000, pct(2000, { maxDiscountPiasters: 5000 }))).toBe(5000);
    expect(couponDiscount(9999, pct(1000, { minSubtotalPiasters: 10000 }))).toBe(0);
    expect(couponDiscount(10000, pct(1000, { minSubtotalPiasters: 10000 }))).toBe(1000);
    expect(couponDiscount(3000, fixed(5000))).toBe(3000);
    expect(couponDiscount(8000, pct(10000))).toBe(8000);
  });

  it("the discount never discounts shipping and the total never goes negative", () => {
    const t = computeTotals({
      lines: [{ unitPricePiasters: 3000, quantity: 1 }],
      shippingPiasters: 7000,
      coupon: fixed(999999),
    });
    expect(t.discountPiasters).toBe(3000);
    expect(t.totalPiasters).toBe(7000);
  });

  it("rejects floats, negatives and bad quantities", () => {
    expect(() =>
      computeTotals({ lines: [{ unitPricePiasters: 10.5, quantity: 1 }], shippingPiasters: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      computeTotals({ lines: [{ unitPricePiasters: -1, quantity: 1 }], shippingPiasters: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      computeTotals({ lines: [{ unitPricePiasters: 1, quantity: 0 }], shippingPiasters: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      computeTotals({ lines: [{ unitPricePiasters: 1, quantity: 1.5 }], shippingPiasters: 0 }),
    ).toThrow(RangeError);
    expect(() => computeTotals({ lines: [], shippingPiasters: -5 })).toThrow(RangeError);
  });
});

describe("state machines", () => {
  it("allows the happy paths", () => {
    assertOrderTransition("pending_payment", "confirmed");
    assertOrderTransition("confirmed", "processing");
    assertOrderTransition("processing", "completed");
    assertPaymentTransition("unpaid", "paid");
    assertPaymentTransition("paid", "refunded");
    assertFulfillmentTransition("unfulfilled", "packing");
    assertFulfillmentTransition("packing", "shipped");
    assertFulfillmentTransition("shipped", "delivered");
  });

  it("terminal states have no exits and illegal jumps fail", () => {
    expect(ORDER_TRANSITIONS.completed).toEqual([]);
    expect(ORDER_TRANSITIONS.cancelled).toEqual([]);
    expect(PAYMENT_TRANSITIONS.refunded).toEqual([]);
    expect(FULFILLMENT_TRANSITIONS.returned).toEqual([]);
    expect(() => assertOrderTransition("completed", "cancelled")).toThrow(InvalidTransition);
    expect(() => assertOrderTransition("cancelled", "confirmed")).toThrow(InvalidTransition);
    expect(() => assertOrderTransition("pending_payment", "completed")).toThrow(InvalidTransition);
    expect(() => assertPaymentTransition("refunded", "paid")).toThrow(InvalidTransition);
    expect(() => assertPaymentTransition("unpaid", "refunded")).toThrow(InvalidTransition);
    expect(() => assertFulfillmentTransition("unfulfilled", "delivered")).toThrow(InvalidTransition);
  });

  it("delivery and pickup use different fulfilment steps", () => {
    expect(fulfillmentAllowedFor("delivery", "shipped")).toBe(true);
    expect(fulfillmentAllowedFor("delivery", "picked_up")).toBe(false);
    expect(fulfillmentAllowedFor("pickup", "ready_for_pickup")).toBe(true);
    expect(fulfillmentAllowedFor("pickup", "shipped")).toBe(false);
  });
});

describe("governorates", () => {
  it("lists 27 unique governorates", () => {
    expect(GOVERNORATES).toHaveLength(27);
    expect(new Set(GOVERNORATES.map((g) => g.key)).size).toBe(27);
  });
});
