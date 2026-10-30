import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../db";
import { brands, categories, media, productTranslations, productVariants, products } from "../../db/schema";
import { audit } from "../audit";
import { requirePermission, type Principal } from "../auth/rbac";
import { productInput, variantInput, type ProductInput, type VariantInput } from "./schemas";

export class NotFoundError extends Error {
  constructor(what = "Not found") {
    super(what);
    this.name = "NotFoundError";
  }
}
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}
export class ValidationFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationFailure";
  }
}

function isUnique(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

async function resolveRefs(db: Db, input: ProductInput) {
  const [cat] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.key, input.categoryKey))
    .limit(1);
  if (!cat) throw new ValidationFailure("Unknown category");
  let brandId: string | null = null;
  if (input.brandKey) {
    const [b] = await db
      .select({ id: brands.id })
      .from(brands)
      .where(eq(brands.key, input.brandKey))
      .limit(1);
    if (!b) throw new ValidationFailure("Unknown brand");
    brandId = b.id;
  }
  return { categoryId: cat.id, brandId };
}

export async function createProduct(db: Db, principal: Principal, raw: unknown): Promise<{ id: string }> {
  requirePermission(principal, "catalog:write");
  const input = productInput.parse(raw);
  const refs = await resolveRefs(db, input);
  try {
    return await db.transaction(async (tx) => {
      const [p] = await tx
        .insert(products)
        .values({
          ...refs,
          frameShape: input.frameShape ?? null,
          featured: input.featured,
          createdBy: principal.userId,
        })
        .returning({ id: products.id });
      await tx.insert(productTranslations).values([
        { productId: p!.id, locale: "ar", ...input.ar },
        { productId: p!.id, locale: "en", ...input.en },
      ]);
      await audit(tx, {
        actorId: principal.userId,
        action: "catalog.product_created",
        entityType: "product",
        entityId: p!.id,
      });
      return { id: p!.id };
    });
  } catch (e) {
    if (isUnique(e)) throw new ConflictError("Slug already used");
    throw e;
  }
}

export async function updateProduct(db: Db, principal: Principal, id: string, raw: unknown): Promise<void> {
  requirePermission(principal, "catalog:write");
  const input = productInput.parse(raw);
  const refs = await resolveRefs(db, input);
  try {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .update(products)
        .set({
          ...refs,
          frameShape: input.frameShape ?? null,
          featured: input.featured,
          updatedAt: new Date(),
        })
        .where(eq(products.id, id))
        .returning({ id: products.id });
      if (!row) throw new NotFoundError("Product not found");
      for (const locale of ["ar", "en"] as const) {
        await tx
          .update(productTranslations)
          .set(input[locale])
          .where(and(eq(productTranslations.productId, id), eq(productTranslations.locale, locale)));
      }
      await audit(tx, {
        actorId: principal.userId,
        action: "catalog.product_updated",
        entityType: "product",
        entityId: id,
      });
    });
  } catch (e) {
    if (isUnique(e)) throw new ConflictError("Slug already used");
    throw e;
  }
}

/** Publishing needs at least one live variant with a price; archived products leave the storefront at once. */
export async function setProductStatus(
  db: Db,
  principal: Principal,
  id: string,
  status: "draft" | "published" | "archived",
): Promise<void> {
  requirePermission(principal, "catalog:publish");
  await db.transaction(async (tx) => {
    if (status === "published") {
      const [v] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(productVariants)
        .where(and(eq(productVariants.productId, id), isNull(productVariants.archivedAt)));
      if (!v || v.n < 1)
        throw new ValidationFailure("A product needs at least one active variant before publishing");
    }
    const [row] = await tx
      .update(products)
      .set({ status, updatedAt: new Date(), publishedAt: status === "published" ? new Date() : undefined })
      .where(eq(products.id, id))
      .returning({ id: products.id });
    if (!row) throw new NotFoundError("Product not found");
    await audit(tx, {
      actorId: principal.userId,
      action: `catalog.product_${status}`,
      entityType: "product",
      entityId: id,
    });
  });
}

export async function addVariant(
  db: Db,
  principal: Principal,
  productId: string,
  raw: unknown,
): Promise<{ id: string }> {
  requirePermission(principal, "catalog:write");
  requirePermission(principal, "catalog:price");
  const input: VariantInput = variantInput.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const [p] = await tx
        .select({ id: products.id })
        .from(products)
        .where(eq(products.id, productId))
        .limit(1);
      if (!p) throw new NotFoundError("Product not found");
      const [v] = await tx
        .insert(productVariants)
        .values({
          productId,
          sku: input.sku,
          colorKey: input.colorKey,
          pricePiasters: input.pricePiasters,
          compareAtPiasters: input.compareAtPiasters ?? null,
          sortOrder: input.sortOrder,
        })
        .returning({ id: productVariants.id });
      await audit(tx, {
        actorId: principal.userId,
        action: "catalog.variant_created",
        entityType: "variant",
        entityId: v!.id,
        detail: `sku=${input.sku} price=${input.pricePiasters}`,
      });
      return { id: v!.id };
    });
  } catch (e) {
    if (isUnique(e)) throw new ConflictError("SKU already exists");
    throw e;
  }
}

/** A price change needs `catalog:price` and is audited with the old and new value. */
export async function updateVariant(
  db: Db,
  principal: Principal,
  variantId: string,
  raw: unknown,
): Promise<void> {
  requirePermission(principal, "catalog:write");
  const input = variantInput.parse(raw);
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(productVariants)
      .where(eq(productVariants.id, variantId))
      .for("update")
      .limit(1);
    if (!before) throw new NotFoundError("Variant not found");
    const priceChanged =
      before.pricePiasters !== input.pricePiasters ||
      (before.compareAtPiasters ?? null) !== (input.compareAtPiasters ?? null);
    if (priceChanged) requirePermission(principal, "catalog:price");
    try {
      await tx
        .update(productVariants)
        .set({
          sku: input.sku,
          colorKey: input.colorKey,
          pricePiasters: input.pricePiasters,
          compareAtPiasters: input.compareAtPiasters ?? null,
          sortOrder: input.sortOrder,
        })
        .where(eq(productVariants.id, variantId));
    } catch (e) {
      if (isUnique(e)) throw new ConflictError("SKU already exists");
      throw e;
    }
    await audit(tx, {
      actorId: principal.userId,
      action: priceChanged ? "catalog.price_changed" : "catalog.variant_updated",
      entityType: "variant",
      entityId: variantId,
      detail: priceChanged ? `price ${before.pricePiasters}->${input.pricePiasters}` : undefined,
    });
  });
}

export async function archiveVariant(db: Db, principal: Principal, variantId: string): Promise<void> {
  requirePermission(principal, "catalog:write");
  const [row] = await db
    .update(productVariants)
    .set({ archivedAt: new Date() })
    .where(eq(productVariants.id, variantId))
    .returning({ id: productVariants.id });
  if (!row) throw new NotFoundError("Variant not found");
  await audit(db, {
    actorId: principal.userId,
    action: "catalog.variant_archived",
    entityType: "variant",
    entityId: variantId,
  });
}

export type AdminProductRow = {
  id: string;
  status: "draft" | "published" | "archived";
  category: string;
  nameAr: string;
  nameEn: string;
  minPrice: number | null;
  variants: number;
  updatedAt: Date;
};

export async function listAdminProducts(db: Db, principal: Principal): Promise<AdminProductRow[]> {
  requirePermission(principal, "catalog:read");
  const rows = await db
    .select({
      id: products.id,
      status: products.status,
      category: categories.key,
      updatedAt: products.updatedAt,
      nameAr: sql<string>`max(${productTranslations.name}) filter (where ${productTranslations.locale} = 'ar')`,
      nameEn: sql<string>`max(${productTranslations.name}) filter (where ${productTranslations.locale} = 'en')`,
    })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .innerJoin(productTranslations, eq(productTranslations.productId, products.id))
    .groupBy(products.id, categories.key)
    .orderBy(desc(products.updatedAt));
  const vs = rows.length
    ? await db
        .select({ productId: productVariants.productId, price: productVariants.pricePiasters })
        .from(productVariants)
        .where(
          and(
            inArray(
              productVariants.productId,
              rows.map((r) => r.id),
            ),
            isNull(productVariants.archivedAt),
          ),
        )
    : [];
  return rows.map((r) => {
    const mine = vs.filter((v) => v.productId === r.id);
    return {
      ...r,
      minPrice: mine.length ? Math.min(...mine.map((v) => v.price)) : null,
      variants: mine.length,
    };
  });
}

export async function getAdminProduct(db: Db, principal: Principal, id: string) {
  requirePermission(principal, "catalog:read");
  const [p] = await db
    .select({ p: products, categoryKey: categories.key, brandKey: brands.key })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(brands, eq(brands.id, products.brandId))
    .where(eq(products.id, id))
    .limit(1);
  if (!p) throw new NotFoundError("Product not found");
  const [translations, variants, images] = await Promise.all([
    db.select().from(productTranslations).where(eq(productTranslations.productId, id)),
    db
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, id))
      .orderBy(asc(productVariants.sortOrder)),
    db.select().from(media).where(eq(media.productId, id)).orderBy(asc(media.sortOrder)),
  ]);
  return { ...p.p, categoryKey: p.categoryKey, brandKey: p.brandKey, translations, variants, images };
}

export async function attachMedia(
  db: Db,
  principal: Principal,
  productId: string,
  file: { r2Key: string; contentType: string; bytes: number; altAr?: string; altEn?: string },
): Promise<{ id: string }> {
  requirePermission(principal, "media:upload");
  const [p] = await db.select({ id: products.id }).from(products).where(eq(products.id, productId)).limit(1);
  if (!p) throw new NotFoundError("Product not found");
  const [m] = await db
    .insert(media)
    .values({
      productId,
      ...file,
      uploadedBy: principal.userId,
      sortOrder: sql`(select coalesce(max(sort_order), -1) + 1 from media where product_id = ${productId})`,
    })
    .returning({ id: media.id });
  await audit(db, {
    actorId: principal.userId,
    action: "media.uploaded",
    entityType: "product",
    entityId: productId,
    detail: `${file.contentType} ${file.bytes}b`,
  });
  return { id: m!.id };
}

export async function removeMedia(db: Db, principal: Principal, mediaId: string): Promise<string> {
  requirePermission(principal, "media:upload");
  const [m] = await db
    .delete(media)
    .where(eq(media.id, mediaId))
    .returning({ r2Key: media.r2Key, productId: media.productId });
  if (!m) throw new NotFoundError("Media not found");
  await audit(db, {
    actorId: principal.userId,
    action: "media.removed",
    entityType: "product",
    entityId: m.productId ?? undefined,
  });
  return m.r2Key;
}
