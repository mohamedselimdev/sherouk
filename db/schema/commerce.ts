import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { branches } from "./branches";
import { productVariants } from "./catalog";
import { customers, users } from "./identity";

export const orderStatus = pgEnum("order_status", [
  "pending_payment",
  "confirmed",
  "processing",
  "completed",
  "cancelled",
]);
export const paymentStatus = pgEnum("payment_status", [
  "unpaid",
  "awaiting_collection",
  "paid",
  "failed",
  "refunded",
]);
export const fulfillmentStatus = pgEnum("fulfillment_status", [
  "unfulfilled",
  "packing",
  "ready_for_pickup",
  "shipped",
  "delivered",
  "picked_up",
  "returned",
]);
export const paymentMethod = pgEnum("payment_method", ["online", "cod"]);
export const deliveryMethod = pgEnum("delivery_method", ["delivery", "pickup"]);
export const reservationStatus = pgEnum("reservation_status", ["active", "committed", "released", "expired"]);
export const movementType = pgEnum("movement_type", ["receipt", "sale", "adjustment", "return_to_stock"]);
export const couponType = pgEnum("coupon_type", ["percent", "fixed"]);

/** Stock per branch and variant. `reserved` is held for unpaid orders; sellable = on_hand - reserved. */
export const branchInventory = pgTable(
  "branch_inventory",
  {
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    onHand: integer("on_hand").notNull().default(0),
    reserved: integer("reserved").notNull().default(0),
    lowStockThreshold: integer("low_stock_threshold").notNull().default(3),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.branchId, t.variantId] }),
    check("inventory_nonneg_chk", sql`${t.onHand} >= 0 and ${t.reserved} >= 0`),
    check("inventory_reserved_chk", sql`${t.reserved} <= ${t.onHand}`),
  ],
);

/** Append-only ledger of every change to `on_hand`. The sum of `quantity` per branch+variant equals `on_hand`. */
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    type: movementType("type").notNull(),
    /** Signed change to on_hand. */
    quantity: integer("quantity").notNull(),
    reason: text("reason"),
    orderId: uuid("order_id"),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("movements_stock_idx").on(t.branchId, t.variantId, t.createdAt),
    check("movements_nonzero_chk", sql`${t.quantity} <> 0`),
  ],
);

export const shippingRates = pgTable(
  "shipping_rates",
  {
    governorate: text("governorate").primaryKey(),
    feePiasters: integer("fee_piasters").notNull(),
    freeOverPiasters: integer("free_over_piasters"),
    active: boolean("active").notNull().default(true),
  },
  (t) => [check("shipping_fee_chk", sql`${t.feePiasters} >= 0`)],
);

export const coupons = pgTable(
  "coupons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    type: couponType("type").notNull(),
    /** percent: basis points (1000 = 10%); fixed: piasters. */
    value: integer("value").notNull(),
    minSubtotalPiasters: integer("min_subtotal_piasters").notNull().default(0),
    maxDiscountPiasters: integer("max_discount_piasters"),
    maxRedemptions: integer("max_redemptions"),
    redeemedCount: integer("redeemed_count").notNull().default(0),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("coupons_code_lower_uq").on(sql`lower(${t.code})`),
    check("coupons_value_chk", sql`${t.value} > 0 and (${t.type} <> 'percent' or ${t.value} <= 10000)`),
    check(
      "coupons_count_chk",
      sql`${t.redeemedCount} >= 0 and (${t.maxRedemptions} is null or ${t.redeemedCount} <= ${t.maxRedemptions})`,
    ),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Human reference shown to the customer, e.g. SH-7K2M9QXA. */
    ref: text("ref").notNull().unique(),
    status: orderStatus("status").notNull().default("pending_payment"),
    paymentStatus: paymentStatus("payment_status").notNull().default("unpaid"),
    fulfillmentStatus: fulfillmentStatus("fulfillment_status").notNull().default("unfulfilled"),
    paymentMethod: paymentMethod("payment_method").notNull(),
    deliveryMethod: deliveryMethod("delivery_method").notNull(),
    /** The single branch the order is fulfilled from (pickup branch, or the online-fulfilment branch that holds the stock). */
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "restrict" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    contactName: text("contact_name").notNull(),
    contactPhone: text("contact_phone").notNull(),
    contactEmail: text("contact_email"),
    shipGovernorate: text("ship_governorate"),
    shipCity: text("ship_city"),
    shipAddress: text("ship_address"),
    notes: text("notes"),
    subtotalPiasters: integer("subtotal_piasters").notNull(),
    discountPiasters: integer("discount_piasters").notNull().default(0),
    shippingPiasters: integer("shipping_piasters").notNull().default(0),
    /** Not calculated until the business confirms tax treatment. */
    taxPiasters: integer("tax_piasters").notNull().default(0),
    totalPiasters: integer("total_piasters").notNull(),
    currency: text("currency").notNull().default("EGP"),
    couponId: uuid("coupon_id").references(() => coupons.id, { onDelete: "set null" }),
    couponCode: text("coupon_code"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    locale: text("locale").notNull().default("ar"),
    /** Set when something needs a human (e.g. payment arrived after the stock hold expired). */
    exception: text("exception"),
    needsRefund: boolean("needs_refund").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("orders_status_idx").on(t.status, t.createdAt),
    index("orders_branch_idx").on(t.branchId, t.createdAt),
    check(
      "orders_amounts_chk",
      sql`${t.subtotalPiasters} >= 0 and ${t.discountPiasters} >= 0 and ${t.shippingPiasters} >= 0 and ${t.taxPiasters} >= 0`,
    ),
    check(
      "orders_total_chk",
      sql`${t.totalPiasters} = ${t.subtotalPiasters} - ${t.discountPiasters} + ${t.shippingPiasters} + ${t.taxPiasters}`,
    ),
    check("orders_discount_chk", sql`${t.discountPiasters} <= ${t.subtotalPiasters}`),
  ],
);

/** Immutable snapshot of what was bought and at what price, whatever the catalog does later. */
export const orderLines = pgTable(
  "order_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    sku: text("sku").notNull(),
    titleAr: text("title_ar").notNull(),
    titleEn: text("title_en").notNull(),
    colorKey: text("color_key").notNull(),
    unitPricePiasters: integer("unit_price_piasters").notNull(),
    quantity: integer("quantity").notNull(),
    lineTotalPiasters: integer("line_total_piasters").notNull(),
  },
  (t) => [
    index("order_lines_order_idx").on(t.orderId),
    check("order_lines_qty_chk", sql`${t.quantity} between 1 and 10`),
    check("order_lines_total_chk", sql`${t.lineTotalPiasters} = ${t.unitPricePiasters} * ${t.quantity}`),
  ],
);

export const orderEvents = pgTable(
  "order_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    fromValue: text("from_value"),
    toValue: text("to_value"),
    actorType: text("actor_type").notNull().default("system"),
    actorId: uuid("actor_id"),
    detail: text("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("order_events_order_idx").on(t.orderId, t.createdAt)],
);

export const stockReservations = pgTable(
  "stock_reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    orderLineId: uuid("order_line_id")
      .notNull()
      .references(() => orderLines.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    status: reservationStatus("status").notNull().default("active"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    index("reservations_status_idx").on(t.status, t.expiresAt),
    index("reservations_order_idx").on(t.orderId),
    check("reservations_qty_chk", sql`${t.quantity} > 0`),
  ],
);

export const couponRedemptions = pgTable(
  "coupon_redemptions",
  {
    couponId: uuid("coupon_id")
      .notNull()
      .references(() => coupons.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.couponId, t.orderId] })],
);
