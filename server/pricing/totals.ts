/**
 * Order money rules, in integer piasters. Pure functions: the same inputs always give the same totals.
 *
 * Policy (documented in docs/orders-inventory.md):
 * - One coupon per order (no stacking in the MVP).
 * - A percent coupon is `floor((subtotal * bp + 5000) / 10000)` (round half up), then capped by the coupon's
 *   maximum and by the subtotal. A fixed coupon never exceeds the subtotal.
 * - Shipping is never discounted by an item coupon. Tax is 0 until the business confirms treatment.
 */

export type CouponRule = {
  type: "percent" | "fixed";
  value: number;
  minSubtotalPiasters: number;
  maxDiscountPiasters: number | null;
};

export type TotalsInput = {
  lines: { unitPricePiasters: number; quantity: number }[];
  shippingPiasters: number;
  coupon?: CouponRule | null;
};

export type Totals = {
  subtotalPiasters: number;
  discountPiasters: number;
  shippingPiasters: number;
  taxPiasters: number;
  totalPiasters: number;
};

function assertInt(n: number, what: string): void {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`${what} must be a non-negative integer`);
}

export function couponDiscount(subtotal: number, coupon: CouponRule): number {
  if (subtotal < coupon.minSubtotalPiasters) return 0;
  const raw = coupon.type === "percent" ? Math.floor((subtotal * coupon.value + 5000) / 10000) : coupon.value;
  const capped = coupon.maxDiscountPiasters === null ? raw : Math.min(raw, coupon.maxDiscountPiasters);
  return Math.min(capped, subtotal);
}

export function computeTotals(input: TotalsInput): Totals {
  assertInt(input.shippingPiasters, "shipping");
  let subtotal = 0;
  for (const l of input.lines) {
    assertInt(l.unitPricePiasters, "unit price");
    if (!Number.isInteger(l.quantity) || l.quantity < 1)
      throw new RangeError("quantity must be a positive integer");
    subtotal += l.unitPricePiasters * l.quantity;
  }
  assertInt(subtotal, "subtotal");
  const discount = input.coupon ? couponDiscount(subtotal, input.coupon) : 0;
  return {
    subtotalPiasters: subtotal,
    discountPiasters: discount,
    shippingPiasters: input.shippingPiasters,
    taxPiasters: 0,
    totalPiasters: subtotal - discount + input.shippingPiasters,
  };
}
