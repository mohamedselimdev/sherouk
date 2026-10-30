import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db, Tx } from "../db";
import {
  branchInventory,
  branchTranslations,
  branches,
  productTranslations,
  productVariants,
  stockMovements,
} from "../../db/schema";
import { audit } from "../audit";
import { requirePermission, visibleBranches, type Principal } from "../auth/rbac";

export class OutOfStockError extends Error {
  constructor(public variantIds: string[]) {
    super("Out of stock");
    this.name = "OutOfStockError";
  }
}
export class NegativeStockError extends Error {
  constructor() {
    super("Stock cannot go below the reserved quantity or below zero");
    this.name = "NegativeStockError";
  }
}

type Conn = Db | Tx;

/**
 * Atomically holds stock: the UPDATE only matches while `on_hand - reserved >= qty`, so two buyers can never
 * both take the last unit. Rows are processed in a fixed order (variant id) so concurrent orders cannot deadlock.
 * Returns the variant ids that could not be held (empty = all held).
 */
export async function reserveAtBranch(
  tx: Conn,
  branchId: string,
  items: { variantId: string; quantity: number }[],
): Promise<string[]> {
  const sorted = [...items].sort((a, b) => a.variantId.localeCompare(b.variantId));
  for (const item of sorted) {
    const rows = await tx
      .update(branchInventory)
      .set({ reserved: sql`${branchInventory.reserved} + ${item.quantity}`, updatedAt: new Date() })
      .where(
        and(
          eq(branchInventory.branchId, branchId),
          eq(branchInventory.variantId, item.variantId),
          sql`${branchInventory.onHand} - ${branchInventory.reserved} >= ${item.quantity}`,
        ),
      )
      .returning({ v: branchInventory.variantId });
    if (rows.length === 0) return [item.variantId];
  }
  return [];
}

export async function releaseReserved(
  tx: Conn,
  branchId: string,
  variantId: string,
  quantity: number,
): Promise<void> {
  const rows = await tx
    .update(branchInventory)
    .set({ reserved: sql`${branchInventory.reserved} - ${quantity}`, updatedAt: new Date() })
    .where(
      and(
        eq(branchInventory.branchId, branchId),
        eq(branchInventory.variantId, variantId),
        sql`${branchInventory.reserved} >= ${quantity}`,
      ),
    )
    .returning({ v: branchInventory.variantId });
  if (rows.length === 0) throw new Error("Reservation bookkeeping mismatch: reserved < released");
}

/** Turns a hold into a sale: on_hand and reserved both drop, and the ledger records it. */
export async function commitSale(
  tx: Conn,
  branchId: string,
  variantId: string,
  quantity: number,
  orderId: string,
): Promise<void> {
  const rows = await tx
    .update(branchInventory)
    .set({
      onHand: sql`${branchInventory.onHand} - ${quantity}`,
      reserved: sql`${branchInventory.reserved} - ${quantity}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(branchInventory.branchId, branchId),
        eq(branchInventory.variantId, variantId),
        sql`${branchInventory.reserved} >= ${quantity}`,
      ),
    )
    .returning({ v: branchInventory.variantId });
  if (rows.length === 0) throw new Error("Reservation bookkeeping mismatch: cannot commit sale");
  await tx
    .insert(stockMovements)
    .values({ branchId, variantId, type: "sale", quantity: -quantity, orderId, reason: "order" });
}

export async function restock(
  tx: Conn,
  branchId: string,
  variantId: string,
  quantity: number,
  orderId: string,
  reason: string,
): Promise<void> {
  await tx
    .insert(branchInventory)
    .values({ branchId, variantId, onHand: quantity })
    .onConflictDoUpdate({
      target: [branchInventory.branchId, branchInventory.variantId],
      set: { onHand: sql`${branchInventory.onHand} + ${quantity}`, updatedAt: new Date() },
    });
  await tx
    .insert(stockMovements)
    .values({ branchId, variantId, type: "return_to_stock", quantity, orderId, reason });
}

export const adjustInput = z.object({
  branchId: z.uuid(),
  variantId: z.uuid(),
  /** Signed change to on-hand units. */
  delta: z
    .number()
    .int()
    .refine((n) => n !== 0, "delta must not be zero")
    .refine((n) => Math.abs(n) <= 100_000, "delta too large"),
  type: z.enum(["receipt", "adjustment"]).default("adjustment"),
  reason: z.string().trim().min(3).max(200),
});

/** Receipts and manual corrections. Always needs a reason, never leaves stock below reserved or below zero, always in the ledger. */
export async function adjustStock(db: Db, principal: Principal, raw: unknown): Promise<{ onHand: number }> {
  const input = adjustInput.parse(raw);
  requirePermission(principal, "inventory:write", input.branchId);
  if (input.type === "receipt" && input.delta < 0)
    throw new z.ZodError([
      { code: "custom", path: ["delta"], message: "receipts add stock", input: input.delta },
    ]);
  return db.transaction(async (tx) => {
    const [v] = await tx
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(eq(productVariants.id, input.variantId))
      .limit(1);
    const [b] = await tx
      .select({ id: branches.id })
      .from(branches)
      .where(eq(branches.id, input.branchId))
      .limit(1);
    if (!v || !b) throw new NegativeStockError();
    await tx
      .insert(branchInventory)
      .values({ branchId: input.branchId, variantId: input.variantId, onHand: 0 })
      .onConflictDoNothing();
    const rows = await tx
      .update(branchInventory)
      .set({ onHand: sql`${branchInventory.onHand} + ${input.delta}`, updatedAt: new Date() })
      .where(
        and(
          eq(branchInventory.branchId, input.branchId),
          eq(branchInventory.variantId, input.variantId),
          sql`${branchInventory.onHand} + ${input.delta} >= ${branchInventory.reserved}`,
        ),
      )
      .returning({ onHand: branchInventory.onHand });
    if (rows.length === 0) throw new NegativeStockError();
    await tx.insert(stockMovements).values({
      branchId: input.branchId,
      variantId: input.variantId,
      type: input.type,
      quantity: input.delta,
      reason: input.reason,
      actorId: principal.userId,
    });
    await audit(tx, {
      actorId: principal.userId,
      action: `inventory.${input.type}`,
      entityType: "variant",
      entityId: input.variantId,
      branchId: input.branchId,
      detail: `${input.delta > 0 ? "+" : ""}${input.delta}: ${input.reason}`,
    });
    return { onHand: rows[0]!.onHand };
  });
}

export type InventoryRow = {
  branchId: string;
  branchName: string;
  variantId: string;
  sku: string;
  productName: string;
  onHand: number;
  reserved: number;
  available: number;
  low: boolean;
};

/** Only branches the principal may read (company-wide roles see all). */
export async function listInventory(
  db: Db,
  principal: Principal,
  locale: "ar" | "en",
): Promise<InventoryRow[]> {
  const scope = visibleBranches(principal, "inventory:read");
  if (Array.isArray(scope) && scope.length === 0) return [];
  const rows = await db
    .select({
      branchId: branchInventory.branchId,
      branchName: branchTranslations.name,
      variantId: branchInventory.variantId,
      sku: productVariants.sku,
      productName: productTranslations.name,
      onHand: branchInventory.onHand,
      reserved: branchInventory.reserved,
      threshold: branchInventory.lowStockThreshold,
    })
    .from(branchInventory)
    .innerJoin(
      branchTranslations,
      and(eq(branchTranslations.branchId, branchInventory.branchId), eq(branchTranslations.locale, locale)),
    )
    .innerJoin(productVariants, eq(productVariants.id, branchInventory.variantId))
    .innerJoin(
      productTranslations,
      and(
        eq(productTranslations.productId, productVariants.productId),
        eq(productTranslations.locale, locale),
      ),
    )
    .where(scope === "all" ? undefined : inArray(branchInventory.branchId, scope))
    .orderBy(asc(branchTranslations.name), asc(productVariants.sku));
  return rows.map((r) => ({
    ...r,
    available: r.onHand - r.reserved,
    low: r.onHand - r.reserved <= r.threshold,
  }));
}

/** Sum of ledger movements per branch+variant; must equal on_hand (reconciliation check). */
export async function reconcileLedger(
  db: Db,
): Promise<{ branchId: string; variantId: string; onHand: number; ledger: number }[]> {
  const rows = await db.execute<{
    branch_id: string;
    variant_id: string;
    on_hand: number;
    ledger: number;
  }>(sql`
    select i.branch_id, i.variant_id, i.on_hand, coalesce(sum(m.quantity), 0)::int as ledger
    from branch_inventory i
    left join stock_movements m on m.branch_id = i.branch_id and m.variant_id = i.variant_id
    group by i.branch_id, i.variant_id, i.on_hand
    having i.on_hand <> coalesce(sum(m.quantity), 0)`);
  return rows.map((r) => ({
    branchId: r.branch_id,
    variantId: r.variant_id,
    onHand: r.on_hand,
    ledger: r.ledger,
  }));
}
