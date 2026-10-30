import { and, asc, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import type { Db, Tx } from "../db";
import { ledgerEntries, orders, paymentAttempts, paymentEvents, refunds } from "../../db/schema";
import { audit } from "../audit";
import { requirePermission, type Principal } from "../auth/rbac";
import { NotFoundError } from "../catalog/admin";
import { markOrderPaidTx, type PaidOutcome } from "../orders/service";
import { PaymentProviderError, type NormalizedEvent, type PaymentProvider } from "./provider";

export class PaymentStartError extends Error {
  constructor(
    public code: "not_payable" | "provider",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "PaymentStartError";
  }
}

/**
 * Opens a new payment attempt for an unpaid online order and returns the provider's hosted-checkout URL.
 * The order and its stock hold are untouched; only a verified provider event can make it paid.
 */
export async function startOnlinePayment(
  db: Db,
  provider: PaymentProvider,
  ref: string,
  urls: { returnUrl: string; notificationUrl: string },
): Promise<{ redirectUrl: string }> {
  const prepared = await db.transaction(async (tx) => {
    const [o] = await tx.select().from(orders).where(eq(orders.ref, ref)).for("update").limit(1);
    if (!o) throw new NotFoundError("Order not found");
    const open =
      o.status === "pending_payment" && (o.paymentStatus === "unpaid" || o.paymentStatus === "failed");
    if (!open || o.paymentMethod !== "online" || (o.expiresAt && o.expiresAt.getTime() <= Date.now()))
      throw new PaymentStartError("not_payable");
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(paymentAttempts)
      .where(eq(paymentAttempts.orderId, o.id));
    const [attempt] = await tx
      .insert(paymentAttempts)
      .values({
        orderId: o.id,
        provider: provider.name,
        specialReference: `${o.ref}-${n! + 1}`,
        amountPiasters: o.totalPiasters,
      })
      .returning();
    return { order: o, attempt: attempt! };
  });

  try {
    const checkout = await provider.createCheckout({
      reference: prepared.attempt.specialReference,
      amountPiasters: prepared.order.totalPiasters,
      description: `Order ${prepared.order.ref}`,
      customer: {
        name: prepared.order.contactName,
        phone: prepared.order.contactPhone,
        email: prepared.order.contactEmail,
      },
      returnUrl: urls.returnUrl,
      notificationUrl: urls.notificationUrl,
    });
    await db
      .update(paymentAttempts)
      .set({
        status: "pending",
        providerIntentionId: checkout.intentionId,
        providerOrderId: checkout.providerOrderId,
        updatedAt: new Date(),
      })
      .where(eq(paymentAttempts.id, prepared.attempt.id));
    return { redirectUrl: checkout.redirectUrl };
  } catch (e) {
    await db
      .update(paymentAttempts)
      .set({ status: "failed", failureReason: "provider_error", updatedAt: new Date() })
      .where(eq(paymentAttempts.id, prepared.attempt.id));
    if (e instanceof PaymentProviderError) throw new PaymentStartError("provider", e.message);
    throw e;
  }
}

export type EventOutcome =
  | "duplicate"
  | "unknown_order"
  | "amount_mismatch"
  | "pending"
  | "paid"
  | "already_paid"
  | "paid_needs_attention"
  | "failed"
  | "ignored_after_paid"
  | "refund_recorded"
  | "refund_ignored";

function eventKey(e: NormalizedEvent): string {
  return [
    e.transactionId,
    e.success,
    e.pending,
    e.errorOccurred,
    e.isVoided,
    e.isRefunded,
    e.isCaptured,
    e.refundedAmountPiasters,
  ].join(":");
}

/**
 * Applies a verified provider event. Safe to call any number of times, in any order:
 * - an identical replay is a no-op (unique event key);
 * - money moves only when the amount, currency and order match what we expected;
 * - a failure that arrives after a success never un-pays an order.
 */
export async function handleProviderEvent(
  db: Db,
  ev: NormalizedEvent,
): Promise<{ outcome: EventOutcome; orderRef?: string }> {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(paymentEvents)
      .values({
        provider: ev.provider,
        eventKey: eventKey(ev),
        providerTransactionId: ev.transactionId,
        amountPiasters: ev.amountPiasters,
        outcome: "received",
        payload: ev.payload,
      })
      .onConflictDoNothing()
      .returning({ id: paymentEvents.id });
    if (inserted.length === 0) return { outcome: "duplicate" as const };
    const eventId = inserted[0]!.id;

    const finish = async (
      outcome: EventOutcome,
      ids: { attemptId?: string; orderId?: string; orderRef?: string } = {},
    ) => {
      await tx
        .update(paymentEvents)
        .set({ outcome, attemptId: ids.attemptId ?? null, orderId: ids.orderId ?? null })
        .where(eq(paymentEvents.id, eventId));
      return { outcome, orderRef: ids.orderRef };
    };

    const [attempt] = await tx
      .select()
      .from(paymentAttempts)
      .where(
        ev.providerOrderId
          ? and(
              eq(paymentAttempts.provider, ev.provider),
              eq(paymentAttempts.providerOrderId, ev.providerOrderId),
            )
          : eq(paymentAttempts.specialReference, ev.merchantReference ?? "\u0000"),
      )
      .for("update")
      .limit(1);
    if (!attempt) return finish("unknown_order");
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, attempt.orderId))
      .for("update")
      .limit(1);
    if (!order) return finish("unknown_order");
    const ids = { attemptId: attempt.id, orderId: order.id, orderRef: order.ref };

    if (ev.currency !== attempt.currency) return finish("amount_mismatch", ids);

    if (ev.isRefunded || ev.isVoided) {
      const outcome = await applyRefundEvent(tx, ev, attempt.id, order);
      return finish(outcome, ids);
    }
    if (ev.amountPiasters !== attempt.amountPiasters) return finish("amount_mismatch", ids);
    if (ev.pending) return finish("pending", ids);

    if (ev.success && !ev.errorOccurred) {
      if (attempt.status === "paid") return finish("already_paid", ids);
      await tx
        .update(paymentAttempts)
        .set({ status: "paid", providerTransactionId: ev.transactionId, updatedAt: new Date() })
        .where(eq(paymentAttempts.id, attempt.id));
      const { outcome } = await markOrderPaidTx(tx, order.ref, {
        type: "provider",
        providerRef: ev.transactionId,
      });
      const mapped: Record<PaidOutcome, EventOutcome> = {
        paid: "paid",
        already_paid: "already_paid",
        reopened_after_late_payment: "paid",
        needs_attention: "paid_needs_attention",
      };
      return finish(mapped[outcome], ids);
    }

    // A failed callback: never downgrade a payment that already succeeded.
    if (attempt.status === "paid" || order.paymentStatus === "paid") return finish("ignored_after_paid", ids);
    await tx
      .update(paymentAttempts)
      .set({
        status: "failed",
        failureReason: "declined",
        providerTransactionId: ev.transactionId,
        updatedAt: new Date(),
      })
      .where(eq(paymentAttempts.id, attempt.id));
    if (order.paymentStatus === "unpaid")
      await tx
        .update(orders)
        .set({ paymentStatus: "failed", updatedAt: new Date() })
        .where(eq(orders.id, order.id));
    return finish("failed", ids);
  });
}

/**
 * Provider refund/void callbacks report the cumulative refunded amount for the transaction, so the delta against what
 * we already recorded is what is new. This makes a refund we executed ourselves and its later callback count once.
 */
async function applyRefundEvent(
  tx: Tx,
  ev: NormalizedEvent,
  attemptId: string,
  order: typeof orders.$inferSelect,
): Promise<EventOutcome> {
  if (order.paymentStatus !== "paid" && order.paymentStatus !== "refunded") return "refund_ignored";
  const cumulative = ev.isVoided
    ? ev.amountPiasters
    : ev.refundedAmountPiasters > 0
      ? ev.refundedAmountPiasters
      : ev.amountPiasters;
  const [{ recorded }] = await tx
    .select({ recorded: sql<number>`coalesce(sum(${refunds.amountPiasters}), 0)::int` })
    .from(refunds)
    .where(and(eq(refunds.orderId, order.id), eq(refunds.status, "succeeded")));
  const delta = cumulative - recorded!;
  if (delta <= 0) return "refund_ignored";

  const [open] = await tx
    .select()
    .from(refunds)
    .where(
      and(
        eq(refunds.orderId, order.id),
        inArray(refunds.status, ["approved", "requested"]),
        eq(refunds.amountPiasters, delta),
      ),
    )
    .limit(1);
  let refundId: string;
  if (open) {
    refundId = open.id;
    await tx
      .update(refunds)
      .set({ status: "succeeded", providerRefundId: ev.transactionId, updatedAt: new Date() })
      .where(eq(refunds.id, open.id));
  } else {
    const [created] = await tx
      .insert(refunds)
      .values({
        orderId: order.id,
        attemptId,
        amountPiasters: delta,
        status: "succeeded",
        reason: "refund made at the provider",
        providerRefundId: ev.transactionId,
      })
      .returning({ id: refunds.id });
    refundId = created!.id;
  }
  await tx
    .insert(ledgerEntries)
    .values({ orderId: order.id, type: "refund", amountPiasters: -delta, reference: `refund:${refundId}` })
    .onConflictDoNothing();
  await refreshRefundedState(tx, order.id);
  return "refund_recorded";
}

async function refreshRefundedState(tx: Tx, orderId: string): Promise<void> {
  const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  const [{ total }] = await tx
    .select({ total: sql<number>`coalesce(sum(${refunds.amountPiasters}), 0)::int` })
    .from(refunds)
    .where(and(eq(refunds.orderId, orderId), eq(refunds.status, "succeeded")));
  if (o && total! >= o.totalPiasters)
    await tx
      .update(orders)
      .set({ paymentStatus: "refunded", needsRefund: false, updatedAt: new Date() })
      .where(eq(orders.id, orderId));
}

/** Recovers payments whose webhook never arrived by asking the provider, then applying the same logic as a webhook. */
export async function reconcilePendingPayments(
  db: Db,
  provider: PaymentProvider,
  opts: { olderThanMinutes?: number; limit?: number } = {},
): Promise<{ checked: number; changed: number }> {
  if (!provider.inquire) return { checked: 0, changed: 0 };
  const cutoff = new Date(Date.now() - (opts.olderThanMinutes ?? 10) * 60_000);
  const pending = await db
    .select()
    .from(paymentAttempts)
    .where(
      and(
        eq(paymentAttempts.status, "pending"),
        isNotNull(paymentAttempts.providerOrderId),
        lt(paymentAttempts.createdAt, cutoff),
      ),
    )
    .orderBy(asc(paymentAttempts.createdAt))
    .limit(opts.limit ?? 25);
  let changed = 0;
  for (const a of pending) {
    const ev = await provider
      .inquire({ reference: a.specialReference, providerOrderId: a.providerOrderId })
      .catch(() => null);
    if (!ev) continue;
    const { outcome } = await handleProviderEvent(db, ev);
    if (outcome !== "duplicate" && outcome !== "pending") changed++;
  }
  return { checked: pending.length, changed };
}

export class RefundError extends Error {
  constructor(
    public code: "not_paid" | "too_much" | "same_person" | "bad_state" | "provider",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "RefundError";
  }
}

async function alreadyRefundedOrPending(tx: Tx, orderId: string): Promise<number> {
  const [r] = await tx
    .select({ n: sql<number>`coalesce(sum(${refunds.amountPiasters}), 0)::int` })
    .from(refunds)
    .where(
      and(eq(refunds.orderId, orderId), inArray(refunds.status, ["requested", "approved", "succeeded"])),
    );
  return r!.n;
}

/** Support asks for a refund; it only becomes money movement after a different person with `refunds:approve` approves it. */
export async function requestRefund(
  db: Db,
  principal: Principal,
  ref: string,
  amountPiasters: number,
  reason: string,
): Promise<{ id: string }> {
  requirePermission(principal, "refunds:request");
  if (!Number.isInteger(amountPiasters) || amountPiasters <= 0)
    throw new RefundError("too_much", "amount must be a positive integer");
  if (reason.trim().length < 3) throw new RefundError("bad_state", "reason required");
  return db.transaction(async (tx) => {
    const [o] = await tx.select().from(orders).where(eq(orders.ref, ref)).for("update").limit(1);
    if (!o) throw new NotFoundError("Order not found");
    if (o.paymentStatus !== "paid") throw new RefundError("not_paid");
    if ((await alreadyRefundedOrPending(tx, o.id)) + amountPiasters > o.totalPiasters)
      throw new RefundError("too_much");
    const [attempt] = await tx
      .select()
      .from(paymentAttempts)
      .where(and(eq(paymentAttempts.orderId, o.id), eq(paymentAttempts.status, "paid")))
      .limit(1);
    const [r] = await tx
      .insert(refunds)
      .values({
        orderId: o.id,
        attemptId: attempt?.id ?? null,
        amountPiasters,
        reason: reason.trim().slice(0, 300),
        requestedBy: principal.userId,
      })
      .returning({ id: refunds.id });
    await audit(tx, {
      actorId: principal.userId,
      action: "refund.requested",
      entityType: "order",
      entityId: o.id,
      branchId: o.branchId,
      detail: `${amountPiasters}`,
    });
    return { id: r!.id };
  });
}

export async function rejectRefund(
  db: Db,
  principal: Principal,
  refundId: string,
  why: string,
): Promise<void> {
  requirePermission(principal, "refunds:approve");
  const [r] = await db
    .update(refunds)
    .set({
      status: "rejected",
      failureReason: why.slice(0, 200),
      approvedBy: principal.userId,
      updatedAt: new Date(),
    })
    .where(and(eq(refunds.id, refundId), eq(refunds.status, "requested")))
    .returning({ id: refunds.id });
  if (!r) throw new RefundError("bad_state");
  await audit(db, {
    actorId: principal.userId,
    action: "refund.rejected",
    entityType: "refund",
    entityId: refundId,
  });
}

/**
 * Four-eyes approval, then execution: card refunds go through the provider adapter; COD cash refunds are recorded as
 * manual. The order only becomes `refunded` when succeeded refunds cover the full total.
 */
export async function approveRefund(
  db: Db,
  principal: Principal,
  refundId: string,
  provider: PaymentProvider | null,
): Promise<{ status: "succeeded" | "failed" }> {
  requirePermission(principal, "refunds:approve");
  const claimed = await db.transaction(async (tx) => {
    const [r] = await tx.select().from(refunds).where(eq(refunds.id, refundId)).for("update").limit(1);
    if (!r || r.status !== "requested") throw new RefundError("bad_state");
    if (r.requestedBy === principal.userId) throw new RefundError("same_person");
    await tx
      .update(refunds)
      .set({ status: "approved", approvedBy: principal.userId, updatedAt: new Date() })
      .where(eq(refunds.id, refundId));
    const [o] = await tx.select().from(orders).where(eq(orders.id, r.orderId)).limit(1);
    const [a] = r.attemptId
      ? await tx.select().from(paymentAttempts).where(eq(paymentAttempts.id, r.attemptId)).limit(1)
      : [];
    await audit(tx, {
      actorId: principal.userId,
      action: "refund.approved",
      entityType: "refund",
      entityId: refundId,
      branchId: o?.branchId,
    });
    return { refund: r, order: o!, attempt: a };
  });

  let providerRefundId: string;
  if (claimed.order.paymentMethod === "cod" || !claimed.attempt) {
    providerRefundId = `manual:${refundId}`;
  } else {
    try {
      if (!provider?.refund || !claimed.attempt.providerTransactionId)
        throw new PaymentProviderError("refund execution is not configured");
      providerRefundId = (
        await provider.refund({
          transactionId: claimed.attempt.providerTransactionId,
          amountPiasters: claimed.refund.amountPiasters,
        })
      ).providerRefundId;
    } catch (e) {
      await db
        .update(refunds)
        .set({ status: "failed", failureReason: (e as Error).message.slice(0, 200), updatedAt: new Date() })
        .where(eq(refunds.id, refundId));
      return { status: "failed" as const };
    }
  }
  await db.transaction(async (tx) => {
    await tx
      .update(refunds)
      .set({ status: "succeeded", providerRefundId, updatedAt: new Date() })
      .where(eq(refunds.id, refundId));
    await tx
      .insert(ledgerEntries)
      .values({
        orderId: claimed.order.id,
        type: "refund",
        amountPiasters: -claimed.refund.amountPiasters,
        reference: `refund:${refundId}`,
      })
      .onConflictDoNothing();
    await refreshRefundedState(tx, claimed.order.id);
  });
  return { status: "succeeded" as const };
}

/** Payment attempts, refunds and the ledger total for the admin order page. */
export async function getPaymentInfo(db: Db, orderId: string) {
  const [attempts, refundRows, ledger] = await Promise.all([
    db
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.orderId, orderId))
      .orderBy(asc(paymentAttempts.createdAt)),
    db.select().from(refunds).where(eq(refunds.orderId, orderId)).orderBy(asc(refunds.createdAt)),
    db
      .select({ total: sql<number>`coalesce(sum(${ledgerEntries.amountPiasters}), 0)::int` })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.orderId, orderId)),
  ]);
  return { attempts, refunds: refundRows, ledgerTotal: ledger[0]!.total };
}
