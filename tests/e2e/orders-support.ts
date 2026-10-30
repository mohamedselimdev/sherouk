import { eq, like, sql } from "drizzle-orm";
import { createDb } from "../../server/db";
import { listStoreProducts } from "../../server/catalog/store";
import { branchInventory, branches, orders, stockMovements } from "../../db/schema";

const DEV_URL = "postgres://shrouk:shrouk_local_only@127.0.0.1:54329/shrouk_dev";

/** Removes orders created by e2e runs and restores the seeded demo stock (20 per variant at the first demo branch). */
export async function resetOrdersAndStock(): Promise<void> {
  const { db, close } = createDb(DEV_URL, 2);
  try {
    // Financial rows use RESTRICT foreign keys on purpose; test data is removed child-first.
    const mine = sql`(select id from orders where contact_name like 'E2E %')`;
    await db.execute(sql`delete from refunds where order_id in ${mine}`);
    await db.execute(sql`delete from ledger_entries where order_id in ${mine}`);
    await db.execute(sql`delete from payment_events where order_id in ${mine}`);
    await db.execute(sql`delete from payment_attempts where order_id in ${mine}`);
    await db.delete(orders).where(like(orders.contactName, "E2E %"));
    // Recompute: ledger = receipts only, on_hand back to 20, reserved 0 for every demo row.
    await db.update(branchInventory).set({ onHand: 20, reserved: 0 });
    await db.delete(stockMovements);
    const rows = await db
      .select({ b: branchInventory.branchId, v: branchInventory.variantId })
      .from(branchInventory);
    if (rows.length)
      await db.insert(stockMovements).values(
        rows.map((r) => ({
          branchId: r.b,
          variantId: r.v,
          type: "receipt" as const,
          quantity: 20,
          reason: "demo opening stock",
        })),
      );
  } finally {
    await close();
  }
}

export async function seededProduct(slug: string) {
  const { db, close } = createDb(DEV_URL, 1);
  try {
    const p = (await listStoreProducts(db)).find((x) => x.slug.en === slug);
    if (!p) throw new Error(`seed product ${slug} missing`);
    return p;
  } finally {
    await close();
  }
}

export async function setStock(variantId: string, onHand: number): Promise<void> {
  const { db, close } = createDb(DEV_URL, 1);
  try {
    await db
      .update(branchInventory)
      .set({ onHand, reserved: 0 })
      .where(eq(branchInventory.variantId, variantId));
  } finally {
    await close();
  }
}

export async function demoBranchIds(): Promise<string[]> {
  const { db, close } = createDb(DEV_URL, 1);
  try {
    return (await db.select({ id: branches.id }).from(branches).where(eq(branches.pickupEnabled, true))).map(
      (b) => b.id,
    );
  } finally {
    await close();
  }
}

export async function orderCount(): Promise<number> {
  const { db, close } = createDb(DEV_URL, 1);
  try {
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(orders)
      .where(like(orders.contactName, "E2E %"));
    return r!.n;
  } finally {
    await close();
  }
}
