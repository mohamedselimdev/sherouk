import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity";
import { orders } from "./commerce";

export const attemptStatus = pgEnum("payment_attempt_status", [
  "initiated",
  "pending",
  "paid",
  "failed",
  "expired",
]);
export const refundStatus = pgEnum("refund_status", [
  "requested",
  "approved",
  "succeeded",
  "failed",
  "rejected",
]);
export const ledgerType = pgEnum("ledger_type", ["charge", "refund", "cod_collected"]);

/** One try to pay an order at a provider. An order can have several (a failed card, then a retry). */
export const paymentAttempts = pgTable(
  "payment_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    provider: text("provider").notNull().default("paymob"),
    /** Our reference sent to the provider as the merchant reference, e.g. SH-7K2M9QXA-1. */
    specialReference: text("special_reference").notNull().unique(),
    providerIntentionId: text("provider_intention_id"),
    /** Provider's order id (Paymob `intention_order_id`); webhooks are matched on it. */
    providerOrderId: text("provider_order_id"),
    providerTransactionId: text("provider_transaction_id"),
    amountPiasters: integer("amount_piasters").notNull(),
    currency: text("currency").notNull().default("EGP"),
    status: attemptStatus("status").notNull().default("initiated"),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("attempts_order_idx").on(t.orderId),
    uniqueIndex("attempts_provider_order_uq").on(t.provider, t.providerOrderId),
    check("attempts_amount_chk", sql`${t.amountPiasters} > 0`),
  ],
);

/**
 * Every verified provider callback, exactly once. `event_key` encodes the transaction and its state flags, so an
 * identical replay is ignored while a genuine state change (success, later refund) is processed.
 */
export const paymentEvents = pgTable(
  "payment_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    eventKey: text("event_key").notNull(),
    providerTransactionId: text("provider_transaction_id").notNull(),
    attemptId: uuid("attempt_id").references(() => paymentAttempts.id, { onDelete: "set null" }),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    amountPiasters: integer("amount_piasters"),
    outcome: text("outcome").notNull(),
    /** Sanitised subset of the callback: no card token, no billing data. */
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payment_events_key_uq").on(t.provider, t.eventKey),
    index("payment_events_order_idx").on(t.orderId),
  ],
);

export const refunds = pgTable(
  "refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    attemptId: uuid("attempt_id").references(() => paymentAttempts.id, { onDelete: "restrict" }),
    amountPiasters: integer("amount_piasters").notNull(),
    status: refundStatus("status").notNull().default("requested"),
    reason: text("reason").notNull(),
    requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    providerRefundId: text("provider_refund_id"),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("refunds_order_idx").on(t.orderId),
    check("refunds_amount_chk", sql`${t.amountPiasters} > 0`),
  ],
);

/** Financial ledger, separate from analytics events. Signed piasters: charges and COD cash are positive, refunds negative. */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    type: ledgerType("type").notNull(),
    amountPiasters: integer("amount_piasters").notNull(),
    /** Provider transaction id or refund id; with `type` it makes each entry idempotent. */
    reference: text("reference").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ledger_ref_uq").on(t.orderId, t.type, t.reference),
    check("ledger_nonzero_chk", sql`${t.amountPiasters} <> 0`),
  ],
);
