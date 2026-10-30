import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db, Tx } from "../db";
import {
  branches,
  couponRedemptions,
  coupons,
  orderEvents,
  orderLines,
  orders,
  productTranslations,
  productVariants,
  ledgerEntries,
  products,
  shippingRates,
  stockReservations,
} from "../../db/schema";
import { audit } from "../audit";
import { requirePermission, visibleBranches, type Principal } from "../auth/rbac";
import { NotFoundError } from "../catalog/admin";
import { GOVERNORATE_KEYS } from "../fulfillment/governorates";
import { commitSale, OutOfStockError, releaseReserved, reserveAtBranch, restock } from "../inventory/service";
import { computeTotals, type CouponRule } from "../pricing/totals";
import {
  assertFulfillmentTransition,
  assertOrderTransition,
  assertPaymentTransition,
  fulfillmentAllowedFor,
  type FulfillmentStatus,
  type OrderStatus,
} from "./state";

type Conn = Db | Tx;

export const RESERVATION_MINUTES = 30;
const MAX_LINE_QTY = 10;

export class InvalidOrder extends Error {
  constructor(
    public code:
      | "empty"
      | "unavailable"
      | "quantity"
      | "shipping"
      | "pickup"
      | "coupon"
      | "payment_method"
      | "state"
      | "forbidden_state",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "InvalidOrder";
  }
}

/** Egyptian mobile numbers only (010/011/012/015). Stored as +20XXXXXXXXXX. */
export function normalizeEgyptPhone(raw: string): string | null {
  const digits = raw.replace(/[\s\-()]/g, "").replace(/^\+/, "");
  const m = /^(?:20|0020|0)?(1[0125]\d{8})$/.exec(digits);
  return m ? `+20${m[1]}` : null;
}

const phone = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const n = normalizeEgyptPhone(v);
    if (!n) ctx.addIssue({ code: "custom", message: "invalid Egyptian mobile number" });
    return n ?? "";
  });

/** `.strict()` on purpose: any client-supplied price, total or discount field makes the request invalid. */
export const orderInput = z
  .object({
    idempotencyKey: z.string().trim().min(16).max(80),
    lines: z
      .array(z.object({ variantId: z.uuid(), quantity: z.number().int().min(1).max(MAX_LINE_QTY) }).strict())
      .min(1)
      .max(20),
    contact: z
      .object({ name: z.string().trim().min(2).max(100), phone, email: z.email().max(254).nullish() })
      .strict(),
    delivery: z.discriminatedUnion("method", [
      z
        .object({
          method: z.literal("delivery"),
          governorate: z.enum(GOVERNORATE_KEYS as [string, ...string[]]),
          city: z.string().trim().min(1).max(80),
          address: z.string().trim().min(5).max(300),
        })
        .strict(),
      z.object({ method: z.literal("pickup"), branchId: z.uuid() }).strict(),
    ]),
    couponCode: z.string().trim().max(40).nullish(),
    paymentMethod: z.enum(["online", "cod"]),
    notes: z.string().trim().max(500).nullish(),
    locale: z.enum(["ar", "en"]).default("ar"),
  })
  .strict();
export type OrderInput = z.input<typeof orderInput>;

export type PricedLine = {
  variantId: string;
  sku: string;
  titleAr: string;
  titleEn: string;
  colorKey: string;
  unitPricePiasters: number;
  quantity: number;
};

function mergeLines(lines: { variantId: string; quantity: number }[]) {
  const map = new Map<string, number>();
  for (const l of lines) map.set(l.variantId, (map.get(l.variantId) ?? 0) + l.quantity);
  return [...map.entries()].map(([variantId, quantity]) => {
    if (quantity > MAX_LINE_QTY) throw new InvalidOrder("quantity", "too many units of one item");
    return { variantId, quantity };
  });
}

/** Prices come from the database only. Unpublished, archived or unknown variants are refused. */
export async function priceLines(
  db: Conn,
  lines: { variantId: string; quantity: number }[],
): Promise<PricedLine[]> {
  const merged = mergeLines(lines);
  if (merged.length === 0) throw new InvalidOrder("empty");
  const rows = await db
    .select({
      variantId: productVariants.id,
      sku: productVariants.sku,
      colorKey: productVariants.colorKey,
      price: productVariants.pricePiasters,
      productId: productVariants.productId,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(
      and(
        inArray(
          productVariants.id,
          merged.map((l) => l.variantId),
        ),
        isNull(productVariants.archivedAt),
        eq(products.status, "published"),
      ),
    );
  const titles = rows.length
    ? await db
        .select()
        .from(productTranslations)
        .where(
          inArray(
            productTranslations.productId,
            rows.map((r) => r.productId),
          ),
        )
    : [];
  return merged.map((l) => {
    const r = rows.find((x) => x.variantId === l.variantId);
    if (!r) throw new InvalidOrder("unavailable", l.variantId);
    const ar = titles.find((t) => t.productId === r.productId && t.locale === "ar");
    const en = titles.find((t) => t.productId === r.productId && t.locale === "en");
    return {
      variantId: r.variantId,
      sku: r.sku,
      titleAr: ar?.name ?? r.sku,
      titleEn: en?.name ?? r.sku,
      colorKey: r.colorKey,
      unitPricePiasters: r.price,
      quantity: l.quantity,
    };
  });
}

export async function shippingFee(db: Conn, governorate: string, subtotal: number): Promise<number> {
  const [rate] = await db
    .select()
    .from(shippingRates)
    .where(and(eq(shippingRates.governorate, governorate), eq(shippingRates.active, true)))
    .limit(1);
  if (!rate) throw new InvalidOrder("shipping", "no delivery to this governorate");
  return rate.freeOverPiasters !== null && subtotal >= rate.freeOverPiasters ? 0 : rate.feePiasters;
}

type LoadedCoupon = { id: string; code: string; rule: CouponRule };

async function loadCoupon(db: Conn, code: string, subtotal: number): Promise<LoadedCoupon> {
  const [c] = await db
    .select()
    .from(coupons)
    .where(sql`lower(${coupons.code}) = ${code.trim().toLowerCase()}`)
    .limit(1);
  const now = Date.now();
  if (!c || !c.active) throw new InvalidOrder("coupon", "invalid");
  if (c.startsAt && c.startsAt.getTime() > now) throw new InvalidOrder("coupon", "not_started");
  if (c.endsAt && c.endsAt.getTime() <= now) throw new InvalidOrder("coupon", "expired");
  if (c.maxRedemptions !== null && c.redeemedCount >= c.maxRedemptions)
    throw new InvalidOrder("coupon", "exhausted");
  if (subtotal < c.minSubtotalPiasters) throw new InvalidOrder("coupon", "min_subtotal");
  return {
    id: c.id,
    code: c.code,
    rule: {
      type: c.type,
      value: c.value,
      minSubtotalPiasters: c.minSubtotalPiasters,
      maxDiscountPiasters: c.maxDiscountPiasters,
    },
  };
}

export type Quote = {
  lines: PricedLine[];
  subtotalPiasters: number;
  discountPiasters: number;
  shippingPiasters: number;
  taxPiasters: number;
  totalPiasters: number;
  coupon: { code: string } | null;
};

/** Read-only price quote for the cart and checkout screens. Does not touch stock or coupon counters. */
export async function quoteOrder(
  db: Db,
  input: {
    lines: { variantId: string; quantity: number }[];
    governorate?: string | null;
    couponCode?: string | null;
    deliveryMethod?: "delivery" | "pickup";
  },
): Promise<Quote> {
  const lines = await priceLines(db, input.lines);
  const subtotal = lines.reduce((n, l) => n + l.unitPricePiasters * l.quantity, 0);
  const shipping =
    input.deliveryMethod === "pickup" || !input.governorate
      ? 0
      : await shippingFee(db, input.governorate, subtotal);
  const coupon = input.couponCode ? await loadCoupon(db, input.couponCode, subtotal) : null;
  const totals = computeTotals({ lines, shippingPiasters: shipping, coupon: coupon?.rule });
  return { lines, ...totals, coupon: coupon ? { code: coupon.code } : null };
}

const REF_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function newRef(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return "SH-" + [...bytes].map((b) => REF_ALPHABET[b % REF_ALPHABET.length]).join("");
}

async function logEvent(
  tx: Conn,
  orderId: string,
  type: string,
  extra: { from?: string; to?: string; actorType?: string; actorId?: string | null; detail?: string } = {},
) {
  await tx.insert(orderEvents).values({
    orderId,
    type,
    fromValue: extra.from,
    toValue: extra.to,
    actorType: extra.actorType ?? "system",
    actorId: extra.actorId ?? null,
    detail: extra.detail?.slice(0, 300),
  });
}

export type CreatedOrder = {
  id: string;
  ref: string;
  totalPiasters: number;
  status: OrderStatus;
  replay: boolean;
};

/**
 * Creates an order in one transaction: server-side pricing, shipping, coupon, stock hold, immutable snapshot.
 * The idempotency key makes a double submit return the first order instead of creating a second one.
 * COD is refused unless the caller (from configuration) allows it.
 */
export async function createOrder(
  db: Db,
  raw: unknown,
  opts: { allowCod: boolean; allowOnline?: boolean; customerId?: string | null },
): Promise<CreatedOrder> {
  const input = orderInput.parse(raw);
  if (input.paymentMethod === "cod" && !opts.allowCod)
    throw new InvalidOrder("payment_method", "cash on delivery is not enabled");
  if (input.paymentMethod === "online" && opts.allowOnline === false)
    throw new InvalidOrder("payment_method", "online payment is not enabled");

  const existing = async (): Promise<CreatedOrder | null> => {
    const [o] = await db
      .select()
      .from(orders)
      .where(eq(orders.idempotencyKey, input.idempotencyKey))
      .limit(1);
    return o
      ? { id: o.id, ref: o.ref, totalPiasters: o.totalPiasters, status: o.status, replay: true }
      : null;
  };
  const prior = await existing();
  if (prior) return prior;

  try {
    return await db.transaction(async (tx) => {
      // Serialise concurrent submits of the same key so only one of them reserves stock.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.idempotencyKey}))`);
      const [again] = await tx
        .select()
        .from(orders)
        .where(eq(orders.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (again)
        return {
          id: again.id,
          ref: again.ref,
          totalPiasters: again.totalPiasters,
          status: again.status,
          replay: true,
        };

      const lines = await priceLines(tx, input.lines);
      const subtotal = lines.reduce((n, l) => n + l.unitPricePiasters * l.quantity, 0);

      let shipping = 0;
      let candidateBranches: string[];
      if (input.delivery.method === "delivery") {
        shipping = await shippingFee(tx, input.delivery.governorate, subtotal);
        candidateBranches = (
          await tx
            .select({ id: branches.id })
            .from(branches)
            .where(and(eq(branches.fulfilsOnline, true), isNull(branches.archivedAt)))
            .orderBy(asc(branches.slug))
        ).map((b) => b.id);
      } else {
        const [b] = await tx
          .select()
          .from(branches)
          .where(
            and(
              eq(branches.id, input.delivery.branchId),
              eq(branches.pickupEnabled, true),
              isNull(branches.archivedAt),
            ),
          )
          .limit(1);
        if (!b) throw new InvalidOrder("pickup", "branch does not offer pickup");
        candidateBranches = [b.id];
      }

      let coupon: LoadedCoupon | null = null;
      if (input.couponCode) {
        coupon = await loadCoupon(tx, input.couponCode, subtotal);
        // The counter is the source of truth: this UPDATE only succeeds while uses remain, even under concurrency.
        const taken = await tx
          .update(coupons)
          .set({ redeemedCount: sql`${coupons.redeemedCount} + 1` })
          .where(
            and(
              eq(coupons.id, coupon.id),
              sql`(${coupons.maxRedemptions} is null or ${coupons.redeemedCount} < ${coupons.maxRedemptions})`,
            ),
          )
          .returning({ id: coupons.id });
        if (taken.length === 0) throw new InvalidOrder("coupon", "exhausted");
      }

      const totals = computeTotals({ lines, shippingPiasters: shipping, coupon: coupon?.rule });

      // Single-branch fulfilment: the first candidate that can hold every line wins. A failed attempt rolls back to a savepoint.
      let branchId: string | null = null;
      let lastShort: string[] = [];
      for (const candidate of candidateBranches) {
        try {
          await tx.transaction(async (sp) => {
            const short = await reserveAtBranch(sp, candidate, lines);
            if (short.length) {
              lastShort = short;
              throw new OutOfStockError(short);
            }
          });
          branchId = candidate;
          break;
        } catch (e) {
          if (!(e instanceof OutOfStockError)) throw e;
        }
      }
      if (!branchId) throw new OutOfStockError(lastShort.length ? lastShort : lines.map((l) => l.variantId));

      const isCod = input.paymentMethod === "cod";
      let order: typeof orders.$inferSelect | undefined;
      for (let attempt = 0; attempt < 5 && !order; attempt++) {
        [order] = await tx
          .insert(orders)
          .values({
            ref: newRef(),
            status: isCod ? "confirmed" : "pending_payment",
            paymentStatus: isCod ? "awaiting_collection" : "unpaid",
            paymentMethod: input.paymentMethod,
            deliveryMethod: input.delivery.method,
            branchId,
            customerId: opts.customerId ?? null,
            contactName: input.contact.name,
            contactPhone: input.contact.phone,
            contactEmail: input.contact.email ?? null,
            shipGovernorate: input.delivery.method === "delivery" ? input.delivery.governorate : null,
            shipCity: input.delivery.method === "delivery" ? input.delivery.city : null,
            shipAddress: input.delivery.method === "delivery" ? input.delivery.address : null,
            notes: input.notes ?? null,
            ...totals,
            couponId: coupon?.id ?? null,
            couponCode: coupon?.code ?? null,
            idempotencyKey: input.idempotencyKey,
            locale: input.locale,
            expiresAt: isCod ? null : new Date(Date.now() + RESERVATION_MINUTES * 60_000),
          })
          .onConflictDoNothing({ target: orders.ref })
          .returning();
      }
      if (!order) throw new Error("could not allocate an order reference");

      const lineRows = await tx
        .insert(orderLines)
        .values(
          lines.map((l) => ({
            orderId: order!.id,
            variantId: l.variantId,
            sku: l.sku,
            titleAr: l.titleAr,
            titleEn: l.titleEn,
            colorKey: l.colorKey,
            unitPricePiasters: l.unitPricePiasters,
            quantity: l.quantity,
            lineTotalPiasters: l.unitPricePiasters * l.quantity,
          })),
        )
        .returning({ id: orderLines.id, variantId: orderLines.variantId, quantity: orderLines.quantity });
      const expires = order.expiresAt ?? new Date();
      await tx.insert(stockReservations).values(
        lineRows.map((l) => ({
          orderId: order!.id,
          orderLineId: l.id,
          branchId: branchId!,
          variantId: l.variantId,
          quantity: l.quantity,
          expiresAt: expires,
        })),
      );
      if (coupon) await tx.insert(couponRedemptions).values({ couponId: coupon.id, orderId: order.id });
      await logEvent(tx, order.id, "created", {
        to: order.status,
        detail: `${input.paymentMethod} ${input.delivery.method}`,
      });

      if (isCod) await confirmReservations(tx, order.id);
      return {
        id: order.id,
        ref: order.ref,
        totalPiasters: order.totalPiasters,
        status: order.status,
        replay: false,
      };
    });
  } catch (e) {
    const code =
      (e as { code?: string; cause?: { code?: string } }).code ??
      (e as { cause?: { code?: string } }).cause?.code;
    if (code === "23505") {
      const raced = await existing();
      if (raced) return raced;
    }
    throw e;
  }
}

/** Active holds become sales (stock leaves on_hand, ledger rows written). Idempotent per reservation. */
async function confirmReservations(tx: Tx, orderId: string): Promise<void> {
  const rows = await tx
    .select()
    .from(stockReservations)
    .where(and(eq(stockReservations.orderId, orderId), eq(stockReservations.status, "active")))
    .for("update");
  for (const r of rows) {
    await commitSale(tx, r.branchId, r.variantId, r.quantity, orderId);
    await tx
      .update(stockReservations)
      .set({ status: "committed", resolvedAt: new Date() })
      .where(eq(stockReservations.id, r.id));
  }
}

async function lockOrder(tx: Tx, where: { id?: string; ref?: string }) {
  const [o] = await tx
    .select()
    .from(orders)
    .where(where.id ? eq(orders.id, where.id) : eq(orders.ref, where.ref!))
    .for("update")
    .limit(1);
  if (!o) throw new NotFoundError("Order not found");
  return o;
}

export type PaidOutcome = "paid" | "already_paid" | "reopened_after_late_payment" | "needs_attention";

/**
 * Called when money is confirmed (Phase 5: verified provider event; staff for manual cases). Idempotent.
 * If the stock hold is gone (expired or cancelled) it tries to re-hold at the same branch; if that fails the
 * payment is still recorded, the order is flagged for a refund and a human decides.
 */
export async function markOrderPaid(
  db: Db,
  ref: string,
  source: { type: "provider" | "staff"; actorId?: string | null; providerRef?: string },
): Promise<{ outcome: PaidOutcome }> {
  return db.transaction((tx) => markOrderPaidTx(tx, ref, source));
}

/** Same as markOrderPaid but inside the caller's transaction (the webhook handler records the event and the payment together). */
export async function markOrderPaidTx(
  tx: Tx,
  ref: string,
  source: { type: "provider" | "staff"; actorId?: string | null; providerRef?: string },
): Promise<{ outcome: PaidOutcome }> {
  {
    const o = await lockOrder(tx, { ref });
    if (o.paymentStatus === "paid") return { outcome: "already_paid" as const };
    if (o.paymentStatus === "refunded") throw new InvalidOrder("state", "refunded order");
    assertPaymentTransition(o.paymentStatus, "paid");

    let outcome: PaidOutcome = "paid";
    let flagged: string | null = null;
    let newStatus: OrderStatus = o.status;

    if (o.status === "pending_payment" || o.status === "cancelled") {
      const active = await tx
        .select()
        .from(stockReservations)
        .where(and(eq(stockReservations.orderId, o.id), eq(stockReservations.status, "active")));
      if (o.status === "pending_payment" && active.length > 0) {
        await confirmReservations(tx, o.id);
        newStatus = "confirmed";
      } else {
        // The hold is gone (expired or cancelled): try to take the stock again, atomically for all lines.
        const lines = await tx.select().from(orderLines).where(eq(orderLines.orderId, o.id));
        const short = o.branchId
          ? await tryReholdAndCommit(tx, o.id, o.branchId, lines)
          : lines.map((l) => l.variantId);
        if (short.length === 0) {
          outcome = o.status === "cancelled" ? "reopened_after_late_payment" : "paid";
          newStatus = "confirmed";
        } else {
          outcome = "needs_attention";
          flagged = o.status === "cancelled" ? "paid_after_cancel_no_stock" : "stock_lost_after_payment";
        }
      }
    }
    // confirmed / processing / completed: stock was already sold when the order was confirmed; only the payment state changes.

    const attention = outcome === "needs_attention";
    await tx
      .update(orders)
      .set({
        paymentStatus: "paid",
        status: newStatus,
        needsRefund: attention,
        exception: flagged,
        cancelledAt: newStatus === "confirmed" ? null : o.cancelledAt,
        cancelReason: newStatus === "confirmed" ? null : o.cancelReason,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, o.id));
    await logEvent(tx, o.id, outcome === "needs_attention" ? "paid_needs_attention" : "paid", {
      from: o.paymentStatus,
      to: "paid",
      actorType: source.type,
      actorId: source.actorId,
      detail: [outcome, source.providerRef].filter(Boolean).join(" "),
    });
    await tx
      .insert(ledgerEntries)
      .values({
        orderId: o.id,
        type: "charge",
        amountPiasters: o.totalPiasters,
        reference: source.providerRef ?? `${source.type}:${o.ref}`,
      })
      .onConflictDoNothing();
    return { outcome };
  }
}

async function tryReholdAndCommit(
  tx: Tx,
  orderId: string,
  branchId: string,
  lines: { id: string; variantId: string; quantity: number }[],
): Promise<string[]> {
  const short = await reserveAtBranch(tx, branchId, lines);
  if (short.length) return short;
  for (const l of lines) {
    await commitSale(tx, branchId, l.variantId, l.quantity, orderId);
    await tx.insert(stockReservations).values({
      orderId,
      orderLineId: l.id,
      branchId,
      variantId: l.variantId,
      quantity: l.quantity,
      status: "committed",
      expiresAt: new Date(),
      resolvedAt: new Date(),
    });
  }
  return [];
}

export type CancelActor = { type: "customer" } | { type: "system" } | { type: "staff"; principal: Principal };

async function releaseCoupon(tx: Tx, orderId: string): Promise<void> {
  const deleted = await tx
    .delete(couponRedemptions)
    .where(eq(couponRedemptions.orderId, orderId))
    .returning({ couponId: couponRedemptions.couponId });
  for (const d of deleted)
    await tx
      .update(coupons)
      .set({ redeemedCount: sql`greatest(${coupons.redeemedCount} - 1, 0)` })
      .where(eq(coupons.id, d.couponId));
}

/** Cancels an order and puts stock back exactly once (hold released, or sold units returned). Idempotent. */
export async function cancelOrder(
  db: Db,
  ref: string,
  actor: CancelActor,
  reason: string,
  opts: { reservationFinal?: "released" | "expired" } = {},
): Promise<{ cancelled: boolean }> {
  return db.transaction(async (tx) => {
    const o = await lockOrder(tx, { ref });
    if (o.status === "cancelled") return { cancelled: false };
    if (actor.type === "staff") requirePermission(actor.principal, "orders:manage", o.branchId);
    if (actor.type === "customer" && (o.status !== "pending_payment" || o.paymentStatus === "paid"))
      throw new InvalidOrder("forbidden_state", "customers can only cancel unpaid orders");
    assertOrderTransition(o.status, "cancelled");
    if (["shipped", "delivered", "picked_up", "ready_for_pickup"].includes(o.fulfillmentStatus))
      throw new InvalidOrder("forbidden_state", "already dispatched; use a return");

    const res = await tx
      .select()
      .from(stockReservations)
      .where(
        and(eq(stockReservations.orderId, o.id), inArray(stockReservations.status, ["active", "committed"])),
      )
      .for("update");
    for (const r of res) {
      if (r.status === "active") await releaseReserved(tx, r.branchId, r.variantId, r.quantity);
      else
        await restock(
          tx,
          r.branchId,
          r.variantId,
          r.quantity,
          o.id,
          `order cancelled: ${reason}`.slice(0, 200),
        );
      await tx
        .update(stockReservations)
        .set({
          status: opts.reservationFinal === "expired" && r.status === "active" ? "expired" : "released",
          resolvedAt: new Date(),
        })
        .where(eq(stockReservations.id, r.id));
    }
    await releaseCoupon(tx, o.id);
    await tx
      .update(orders)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        cancelReason: reason.slice(0, 200),
        needsRefund: o.paymentStatus === "paid",
        updatedAt: new Date(),
      })
      .where(eq(orders.id, o.id));
    await logEvent(tx, o.id, "cancelled", {
      from: o.status,
      to: "cancelled",
      actorType: actor.type,
      actorId: actor.type === "staff" ? actor.principal.userId : null,
      detail: reason,
    });
    if (actor.type === "staff")
      await audit(tx, {
        actorId: actor.principal.userId,
        action: "order.cancelled",
        entityType: "order",
        entityId: o.id,
        branchId: o.branchId,
        detail: reason,
      });
    return { cancelled: true };
  });
}

/** Releases holds that were never paid. Safe to run often and from several workers at once. */
export async function expireStaleOrders(db: Db, now = new Date(), limit = 50): Promise<{ expired: number }> {
  const due = await db
    .select({ ref: orders.ref })
    .from(orders)
    .where(
      and(
        eq(orders.status, "pending_payment"),
        eq(orders.paymentStatus, "unpaid"),
        lt(orders.expiresAt, now),
      ),
    )
    .orderBy(asc(orders.expiresAt))
    .limit(limit);
  let expired = 0;
  for (const { ref } of due) {
    try {
      const r = await cancelOrder(db, ref, { type: "system" }, "payment window expired", {
        reservationFinal: "expired",
      });
      if (r.cancelled) expired++;
    } catch (e) {
      if (!(e instanceof InvalidOrder)) throw e;
    }
  }
  return { expired };
}

export async function advanceFulfillment(
  db: Db,
  principal: Principal,
  ref: string,
  to: FulfillmentStatus,
): Promise<void> {
  await db.transaction(async (tx) => {
    const o = await lockOrder(tx, { ref });
    requirePermission(principal, "orders:manage", o.branchId);
    if (o.status !== "confirmed" && o.status !== "processing")
      throw new InvalidOrder("state", "order is not open for fulfilment");
    assertFulfillmentTransition(o.fulfillmentStatus, to);
    if (!fulfillmentAllowedFor(o.deliveryMethod, to))
      throw new InvalidOrder("state", "step does not match the delivery method");
    const status: OrderStatus = to === "delivered" || to === "picked_up" ? "completed" : "processing";
    if (status !== o.status) assertOrderTransition(o.status, status);
    await tx
      .update(orders)
      .set({ fulfillmentStatus: to, status, updatedAt: new Date() })
      .where(eq(orders.id, o.id));
    await logEvent(tx, o.id, "fulfillment", {
      from: o.fulfillmentStatus,
      to,
      actorType: "staff",
      actorId: principal.userId,
    });
    await audit(tx, {
      actorId: principal.userId,
      action: "order.fulfillment",
      entityType: "order",
      entityId: o.id,
      branchId: o.branchId,
      detail: `${o.fulfillmentStatus}->${to}`,
    });
  });
}

/** COD cash is "paid" only when staff record the collection after hand-over; submitting the order never marks it paid. */
export async function recordCodCollection(db: Db, principal: Principal, ref: string): Promise<void> {
  await db.transaction(async (tx) => {
    const o = await lockOrder(tx, { ref });
    requirePermission(principal, "orders:manage", o.branchId);
    if (o.paymentMethod !== "cod") throw new InvalidOrder("state", "not a cash-on-delivery order");
    if (o.paymentStatus === "paid") return;
    if (!["delivered", "picked_up"].includes(o.fulfillmentStatus))
      throw new InvalidOrder("state", "collect cash after hand-over");
    assertPaymentTransition(o.paymentStatus, "paid");
    await tx.update(orders).set({ paymentStatus: "paid", updatedAt: new Date() }).where(eq(orders.id, o.id));
    await tx
      .insert(ledgerEntries)
      .values({
        orderId: o.id,
        type: "cod_collected",
        amountPiasters: o.totalPiasters,
        reference: `cod:${o.ref}`,
      })
      .onConflictDoNothing();
    await logEvent(tx, o.id, "cod_collected", {
      from: o.paymentStatus,
      to: "paid",
      actorType: "staff",
      actorId: principal.userId,
    });
    await audit(tx, {
      actorId: principal.userId,
      action: "order.cod_collected",
      entityType: "order",
      entityId: o.id,
      branchId: o.branchId,
    });
  });
}

export async function listOrders(db: Db, principal: Principal, filter: { status?: OrderStatus } = {}) {
  const scope = visibleBranches(principal, "orders:read");
  if (Array.isArray(scope) && scope.length === 0) return [];
  return db
    .select()
    .from(orders)
    .where(
      and(
        scope === "all" ? undefined : inArray(orders.branchId, scope),
        filter.status ? eq(orders.status, filter.status) : undefined,
      ),
    )
    .orderBy(desc(orders.createdAt))
    .limit(200);
}

export async function getOrderForStaff(db: Db, principal: Principal, ref: string) {
  const [o] = await db.select().from(orders).where(eq(orders.ref, ref)).limit(1);
  if (!o) throw new NotFoundError("Order not found");
  requirePermission(principal, "orders:read", o.branchId);
  const [lines, events] = await Promise.all([
    db.select().from(orderLines).where(eq(orderLines.orderId, o.id)),
    db.select().from(orderEvents).where(eq(orderEvents.orderId, o.id)).orderBy(asc(orderEvents.createdAt)),
  ]);
  return { order: o, lines, events };
}

/** Customer-facing view: by reference plus the phone number used on the order. Wrong phone looks the same as no order. */
export async function getOrderForCustomer(db: Db, ref: string, phoneRaw: string) {
  const phoneNorm = normalizeEgyptPhone(phoneRaw);
  if (!phoneNorm) return null;
  const [o] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.ref, ref.trim().toUpperCase()), eq(orders.contactPhone, phoneNorm)))
    .limit(1);
  return o ? publicOrderView(db, o) : null;
}

export async function getOrderByRef(db: Db, ref: string) {
  const [o] = await db.select().from(orders).where(eq(orders.ref, ref)).limit(1);
  return o ? publicOrderView(db, o) : null;
}

async function publicOrderView(db: Db, o: typeof orders.$inferSelect) {
  const lines = await db.select().from(orderLines).where(eq(orderLines.orderId, o.id));
  return {
    ref: o.ref,
    status: o.status,
    paymentStatus: o.paymentStatus,
    fulfillmentStatus: o.fulfillmentStatus,
    paymentMethod: o.paymentMethod,
    deliveryMethod: o.deliveryMethod,
    subtotalPiasters: o.subtotalPiasters,
    discountPiasters: o.discountPiasters,
    shippingPiasters: o.shippingPiasters,
    totalPiasters: o.totalPiasters,
    couponCode: o.couponCode,
    expiresAt: o.expiresAt,
    createdAt: o.createdAt,
    lines: lines.map((l) => ({
      sku: l.sku,
      titleAr: l.titleAr,
      titleEn: l.titleEn,
      colorKey: l.colorKey,
      unitPricePiasters: l.unitPricePiasters,
      quantity: l.quantity,
      lineTotalPiasters: l.lineTotalPiasters,
    })),
  };
}
