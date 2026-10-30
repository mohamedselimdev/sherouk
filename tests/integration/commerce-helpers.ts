import { and, eq } from "drizzle-orm";
import {
  branches,
  branchInventory,
  categories,
  categoryTranslations,
  coupons,
  productTranslations,
  productVariants,
  products,
  shippingRates,
  stockMovements,
} from "../../db/schema";
import { db } from "./helpers";

let counter = 0;
const next = () => ++counter;

export async function makeCategory(key = "sunglasses"): Promise<string> {
  const [c] = await db
    .insert(categories)
    .values({ key })
    .onConflictDoNothing()
    .returning({ id: categories.id });
  if (c) {
    await db.insert(categoryTranslations).values([
      { categoryId: c.id, locale: "ar", name: "فئة" },
      { categoryId: c.id, locale: "en", name: "Category" },
    ]);
    return c.id;
  }
  const [existing] = await db.select({ id: categories.id }).from(categories).where(eq(categories.key, key));
  return existing!.id;
}

/** A published product with one variant at `price` piasters. */
export async function makeVariant(
  price = 100000,
  opts: { status?: "draft" | "published" | "archived"; archivedVariant?: boolean } = {},
): Promise<string> {
  const categoryId = await makeCategory();
  const n = next();
  const [p] = await db
    .insert(products)
    .values({ categoryId, status: opts.status ?? "published" })
    .returning({ id: products.id });
  await db.insert(productTranslations).values([
    {
      productId: p!.id,
      locale: "ar",
      name: `منتج ${n}`,
      slug: `p-${n}-${Math.random().toString(36).slice(2, 8)}`,
    },
    {
      productId: p!.id,
      locale: "en",
      name: `Product ${n}`,
      slug: `p-${n}-${Math.random().toString(36).slice(2, 8)}`,
    },
  ]);
  const [v] = await db
    .insert(productVariants)
    .values({
      productId: p!.id,
      sku: `SKU-${n}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      colorKey: "black",
      pricePiasters: price,
      archivedAt: opts.archivedVariant ? new Date() : null,
    })
    .returning({ id: productVariants.id });
  return v!.id;
}

export async function makeOnlineBranch(
  slug: string,
  opts: { pickup?: boolean; online?: boolean } = {},
): Promise<string> {
  const [b] = await db
    .insert(branches)
    .values({ slug, verified: true, pickupEnabled: opts.pickup ?? false, fulfilsOnline: opts.online ?? true })
    .returning({ id: branches.id });
  return b!.id;
}

/** Sets on-hand stock and writes the matching opening receipt so the ledger reconciles. */
export async function stock(branchId: string, variantId: string, onHand: number): Promise<void> {
  await db
    .delete(stockMovements)
    .where(and(eq(stockMovements.branchId, branchId), eq(stockMovements.variantId, variantId)));
  await db
    .insert(branchInventory)
    .values({ branchId, variantId, onHand })
    .onConflictDoUpdate({ target: [branchInventory.branchId, branchInventory.variantId], set: { onHand } });
  if (onHand > 0)
    await db
      .insert(stockMovements)
      .values({ branchId, variantId, type: "receipt", quantity: onHand, reason: "opening stock" });
}

export async function inventoryOf(branchId: string, variantId: string) {
  const [row] = await db
    .select()
    .from(branchInventory)
    .where(and(eq(branchInventory.branchId, branchId), eq(branchInventory.variantId, variantId)));
  return row!;
}

export async function rate(governorate: string, fee: number, freeOver: number | null = null): Promise<void> {
  await db
    .insert(shippingRates)
    .values({ governorate, feePiasters: fee, freeOverPiasters: freeOver })
    .onConflictDoNothing();
}

export async function coupon(code: string, v: Partial<typeof coupons.$inferInsert> = {}): Promise<string> {
  const [c] = await db
    .insert(coupons)
    .values({ code, type: "percent", value: 1000, ...v })
    .returning({ id: coupons.id });
  return c!.id;
}

let keySeq = 0;
export const key = () =>
  `test-idempotency-key-${Date.now()}-${++keySeq}-${Math.random().toString(36).slice(2, 8)}`;

export function deliveryOrder(variantId: string, quantity = 1, extra: Record<string, unknown> = {}) {
  return {
    idempotencyKey: key(),
    lines: [{ variantId, quantity }],
    contact: { name: "Test Buyer", phone: "01012345678", email: "buyer@example.com" },
    delivery: {
      method: "delivery",
      governorate: "cairo",
      city: "Nasr City",
      address: "12 Test Street, Apt 4",
    },
    paymentMethod: "online",
    locale: "en",
    ...extra,
  };
}
