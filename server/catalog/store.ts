import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "../db";
import {
  categories,
  branchInventory,
  categoryTranslations,
  media,
  productTranslations,
  productVariants,
  products,
} from "../../db/schema";

export type L10n = { ar: string; en: string };
export type Locale = keyof L10n;

export type StoreColor = {
  colorKey: string;
  variantId: string;
  sku: string;
  price: number;
  compareAt: number | null;
};

/** Public, bilingual read model. Prices are integer piasters. */
export type StoreProduct = {
  id: string;
  slug: L10n;
  name: L10n;
  sub: L10n;
  description: L10n;
  category: string;
  /** Lowest active variant price. */
  price: number;
  /** Compare-at price of that same variant when it is a real markdown. */
  oldPrice: number | null;
  image: string | null;
  images: string[];
  colors: StoreColor[];
  featured: boolean;
  shape: string | null;
  /** True when some branch has sellable units of at least one active variant. */
  inStock: boolean;
};

export type StoreCategory = { key: string; name: string; blurb: string };

/** Seed/demo media keys beginning with `static:` point at files shipped in /public/assets. */
export function mediaUrl(r2Key: string): string {
  return r2Key.startsWith("static:") ? r2Key.slice(7) : `/media/${r2Key}`;
}

export async function listStoreCategories(db: Db, locale: Locale): Promise<StoreCategory[]> {
  const rows = await db
    .select({ key: categories.key, name: categoryTranslations.name, blurb: categoryTranslations.blurb })
    .from(categories)
    .innerJoin(
      categoryTranslations,
      and(eq(categoryTranslations.categoryId, categories.id), eq(categoryTranslations.locale, locale)),
    )
    .where(isNull(categories.archivedAt))
    .orderBy(asc(categories.sortOrder));
  return rows.map((r) => ({ key: r.key, name: r.name, blurb: r.blurb ?? "" }));
}

async function assemble(db: Db, extra?: { locale: Locale; slug: string }): Promise<StoreProduct[]> {
  const ar = alias(productTranslations, "tr_ar");
  const en = alias(productTranslations, "tr_en");
  const rows = await db
    .select({
      id: products.id,
      category: categories.key,
      featured: products.featured,
      shape: products.frameShape,
      ar,
      en,
    })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .innerJoin(ar, and(eq(ar.productId, products.id), eq(ar.locale, "ar")))
    .innerJoin(en, and(eq(en.productId, products.id), eq(en.locale, "en")))
    .where(
      and(
        eq(products.status, "published"),
        extra ? eq((extra.locale === "ar" ? ar : en).slug, extra.slug) : undefined,
      ),
    );
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [variants, images, stockRows] = await Promise.all([
    db
      .select()
      .from(productVariants)
      .where(and(inArray(productVariants.productId, ids), isNull(productVariants.archivedAt)))
      .orderBy(asc(productVariants.sortOrder), asc(productVariants.pricePiasters)),
    db.select().from(media).where(inArray(media.productId, ids)).orderBy(asc(media.sortOrder)),
    db
      .select({
        variantId: branchInventory.variantId,
        available: sql<number>`sum(${branchInventory.onHand} - ${branchInventory.reserved})::int`,
      })
      .from(branchInventory)
      .groupBy(branchInventory.variantId),
  ]);
  return rows
    .map((r): StoreProduct | null => {
      const vs = variants.filter((v) => v.productId === r.id);
      if (!vs.length) return null;
      const cheapest = vs.reduce((a, b) => (b.pricePiasters < a.pricePiasters ? b : a));
      const imgs = images.filter((m) => m.productId === r.id).map((m) => mediaUrl(m.r2Key));
      return {
        id: r.id,
        slug: { ar: r.ar.slug, en: r.en.slug },
        name: { ar: r.ar.name, en: r.en.name },
        sub: { ar: r.ar.subtitle ?? "", en: r.en.subtitle ?? "" },
        description: { ar: r.ar.description ?? "", en: r.en.description ?? "" },
        category: r.category,
        price: cheapest.pricePiasters,
        oldPrice: cheapest.compareAtPiasters,
        image: imgs[0] ?? null,
        images: imgs,
        colors: vs.map((v) => ({
          colorKey: v.colorKey,
          variantId: v.id,
          sku: v.sku,
          price: v.pricePiasters,
          compareAt: v.compareAtPiasters,
        })),
        featured: r.featured,
        shape: r.shape,
        inStock: vs.some((v) => (stockRows.find((x) => x.variantId === v.id)?.available ?? 0) > 0),
      };
    })
    .filter((p): p is StoreProduct => p !== null);
}

/** Only published products ever reach the storefront. */
export function listStoreProducts(db: Db): Promise<StoreProduct[]> {
  return assemble(db);
}

export async function getStoreProduct(db: Db, locale: Locale, slug: string): Promise<StoreProduct | null> {
  const [p] = await assemble(db, { locale, slug });
  return p ?? null;
}
