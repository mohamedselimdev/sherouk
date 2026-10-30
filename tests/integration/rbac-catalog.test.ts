import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ZodError } from "zod";
import { auditEntries, categories, categoryTranslations, productVariants } from "../../db/schema";
import {
  can,
  ForbiddenError,
  loadPrincipal,
  ROLE_DEFS,
  PERMISSIONS,
  syncRolesAndPermissions,
  visibleBranches,
} from "../../server/auth/rbac";
import {
  addVariant,
  archiveVariant,
  ConflictError,
  createProduct,
  getAdminProduct,
  listAdminProducts,
  setProductStatus,
  updateProduct,
  updateVariant,
  ValidationFailure,
  attachMedia,
} from "../../server/catalog/admin";
import { getStoreProduct, listStoreProducts } from "../../server/catalog/store";
import {
  createBranch,
  listBranches,
  setBranchHours,
  updateBranchContact,
} from "../../server/branches/service";
import { closeDb, db, makeBranch, makeStaff, reset } from "./helpers";

beforeEach(async () => {
  await reset();
  const [c] = await db.insert(categories).values({ key: "sunglasses" }).returning();
  await db.insert(categoryTranslations).values([
    { categoryId: c!.id, locale: "ar", name: "النظارات الشمسية" },
    { categoryId: c!.id, locale: "en", name: "Sunglasses" },
  ]);
});
afterAll(closeDb);

const product = (slug = "classic") => ({
  categoryKey: "sunglasses",
  frameShape: "square" as const,
  featured: true,
  ar: { name: "كلاسيك", slug: `${slug}-ar` },
  en: { name: "Classic", slug: `${slug}-en`, subtitle: "Black frame" },
});
const variant = (sku = "SH-001", price = 245000) => ({
  sku,
  colorKey: "black" as const,
  pricePiasters: price,
});

async function principal(email: string, role: string, branchId: string | null = null) {
  return loadPrincipal(db, await makeStaff(email, role, branchId));
}

describe("role definitions", () => {
  it("every role only references defined permissions and the database mirrors the code", async () => {
    for (const def of Object.values(ROLE_DEFS))
      for (const p of def.permissions) expect(PERMISSIONS).toHaveProperty(p);
    await syncRolesAndPermissions(db); // idempotent
    const admin = await principal("a@shrouk.test", "hq_admin");
    expect(new Set(admin.grants.map((g) => g.permission))).toEqual(new Set(Object.keys(PERMISSIONS)));
  });
});

describe("authorization", () => {
  it("deny by default: a role without the permission cannot write the catalog", async () => {
    const support = await principal("s@shrouk.test", "customer_support");
    await expect(createProduct(db, support, product())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listAdminProducts(db, support)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("a user with no role assignment has no grants at all", async () => {
    const { userId } = { userId: (await principal("x@shrouk.test", "hq_admin")).userId };
    const nobody = { userId, grants: [] };
    expect(can(nobody, "catalog:read")).toBe(false);
    await expect(createProduct(db, nobody, product())).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("content editors can read and upload media but cannot publish or change prices", async () => {
    const admin = await principal("a@shrouk.test", "hq_admin");
    const editor = await principal("e@shrouk.test", "content_editor");
    const { id } = await createProduct(db, admin, product());
    await expect(listAdminProducts(db, editor)).resolves.toHaveLength(1);
    await expect(setProductStatus(db, editor, id, "published")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(addVariant(db, editor, id, variant())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      attachMedia(db, editor, id, { r2Key: "products/a.png", contentType: "image/png", bytes: 10 }),
    ).resolves.toBeTruthy();
  });

  it("price changes need catalog:price even with catalog:write", async () => {
    const admin = await principal("a@shrouk.test", "hq_admin");
    const { id } = await createProduct(db, admin, product());
    const { id: variantId } = await addVariant(db, admin, id, variant());
    const writerNoPrice = { ...admin, grants: admin.grants.filter((g) => g.permission !== "catalog:price") };
    await expect(
      updateVariant(db, writerNoPrice, variantId, variant("SH-001", 199900)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      updateVariant(db, writerNoPrice, variantId, { ...variant("SH-001", 245000), sortOrder: 3 }),
    ).resolves.toBeUndefined();
    await updateVariant(db, admin, variantId, variant("SH-001", 199900));
    const log = await db.select().from(auditEntries).where(eq(auditEntries.action, "catalog.price_changed"));
    expect(log).toHaveLength(1);
    expect(log[0]!.detail).toBe("price 245000->199900");
  });
});

describe("branch isolation", () => {
  it("a branch manager can only edit their own branch (cross-branch write denied)", async () => {
    const a = await makeBranch("a");
    const b = await makeBranch("b");
    const mgrA = await principal("ma@shrouk.test", "branch_manager", a);
    await expect(updateBranchContact(db, mgrA, a, { phone: "+20 100 000 0001" })).resolves.toBeUndefined();
    await expect(updateBranchContact(db, mgrA, b, { phone: "+20 100 000 0002" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(setBranchHours(db, mgrA, b, [])).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      setBranchHours(db, mgrA, a, [{ weekday: 1, opensAt: "10:00", closesAt: "22:00", closed: false }]),
    ).resolves.toBeUndefined();
  });

  it("list queries are scoped to the principal's branches", async () => {
    const a = await makeBranch("a");
    await makeBranch("b");
    const mgrA = await principal("ma@shrouk.test", "branch_manager", a);
    const admin = await principal("hq@shrouk.test", "hq_admin");
    expect(visibleBranches(mgrA, "branches:read")).toEqual([a]);
    expect(visibleBranches(admin, "branches:read")).toBe("all");
    const mine = await listBranches(db, mgrA);
    expect(new Set(mine.map((r) => r.id))).toEqual(new Set([a]));
    expect(new Set((await listBranches(db, admin)).map((r) => r.slug))).toEqual(new Set(["a", "b"]));
  });

  it("branch managers cannot touch company-wide resources and cannot create branches", async () => {
    const a = await makeBranch("a");
    const mgrA = await principal("ma@shrouk.test", "branch_manager", a);
    expect(can(mgrA, "branches:write", a)).toBe(true);
    expect(can(mgrA, "branches:write", null)).toBe(false);
    await expect(
      createBranch(db, mgrA, {
        slug: "c",
        ar: { name: "ج", city: "ج", address: "ج" },
        en: { name: "C", city: "C", address: "C" },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createProduct(db, mgrA, product())).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("a user with no branch-less grant is not treated as company-wide", async () => {
    const a = await makeBranch("a");
    const inv = await principal("i@shrouk.test", "inventory_staff", a);
    expect(can(inv, "inventory:write", a)).toBe(true);
    expect(can(inv, "inventory:write", "00000000-0000-0000-0000-000000000000")).toBe(false);
    expect(can(inv, "inventory:write")).toBe(false);
  });
});

describe("catalog", () => {
  it("drafts are invisible to the storefront; publishing needs a variant", async () => {
    const admin = await principal("a@shrouk.test", "hq_admin");
    const { id } = await createProduct(db, admin, product());
    expect(await listStoreProducts(db)).toHaveLength(0);
    await expect(setProductStatus(db, admin, id, "published")).rejects.toBeInstanceOf(ValidationFailure);
    await addVariant(db, admin, id, variant());
    await setProductStatus(db, admin, id, "published");
    const list = await listStoreProducts(db);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      slug: { ar: "classic-ar", en: "classic-en" },
      name: { ar: "كلاسيك", en: "Classic" },
      price: 245000,
      category: "sunglasses",
    });
    expect((await getStoreProduct(db, "ar", "classic-ar"))?.name.ar).toBe("كلاسيك");
    expect(await getStoreProduct(db, "en", "classic-ar")).toBeNull();
  });

  it("archiving removes a product from the storefront; archived variants are not sold", async () => {
    const admin = await principal("a@shrouk.test", "hq_admin");
    const { id } = await createProduct(db, admin, product());
    const v1 = await addVariant(db, admin, id, variant("SH-001", 300000));
    await addVariant(db, admin, id, variant("SH-002", 250000));
    await setProductStatus(db, admin, id, "published");
    expect((await getStoreProduct(db, "en", "classic-en"))?.price).toBe(250000);
    await archiveVariant(db, admin, v1.id);
    expect((await getStoreProduct(db, "en", "classic-en"))?.colors).toHaveLength(1);
    await setProductStatus(db, admin, id, "archived");
    expect(await listStoreProducts(db)).toHaveLength(0);
  });

  it("duplicate slugs and SKUs are conflicts, not crashes", async () => {
    const admin = await principal("a@shrouk.test", "hq_admin");
    const { id } = await createProduct(db, admin, product("one"));
    await expect(createProduct(db, admin, product("one"))).rejects.toBeInstanceOf(ConflictError);
    await addVariant(db, admin, id, variant("SH-001"));
    await expect(addVariant(db, admin, id, variant("SH-001"))).rejects.toBeInstanceOf(ConflictError);
  });

  it("validates input: negative/float prices, bad compare-at, bad slug, unknown category", async () => {
    const admin = await principal("a@shrouk.test", "hq_admin");
    const { id } = await createProduct(db, admin, product());
    await expect(addVariant(db, admin, id, variant("SH-9", -1))).rejects.toBeInstanceOf(ZodError);
    await expect(addVariant(db, admin, id, variant("SH-9", 10.5))).rejects.toBeInstanceOf(ZodError);
    await expect(
      addVariant(db, admin, id, { ...variant("SH-9", 1000), compareAtPiasters: 900 }),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(
      createProduct(db, admin, { ...product("x"), ar: { name: "x", slug: "Bad Slug!" } }),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(createProduct(db, admin, { ...product("y"), categoryKey: "nope" })).rejects.toBeInstanceOf(
      ValidationFailure,
    );
  });

  it("the database itself rejects negative prices (constraint, not just app code)", async () => {
    const admin = await principal("a@shrouk.test", "hq_admin");
    const { id } = await createProduct(db, admin, product());
    await expect(
      db
        .insert(productVariants)
        .values({ productId: id, sku: "RAW-1", colorKey: "black", pricePiasters: -5 }),
    ).rejects.toThrow();
  });

  it("product updates change translations and are audited", async () => {
    const admin = await principal("a@shrouk.test", "hq_admin");
    const { id } = await createProduct(db, admin, product());
    await updateProduct(db, admin, id, { ...product(), en: { name: "Renamed", slug: "classic-en" } });
    const p = await getAdminProduct(db, admin, id);
    expect(p.translations.find((t) => t.locale === "en")?.name).toBe("Renamed");
    const log = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.action, "catalog.product_updated"));
    expect(log).toHaveLength(1);
  });
});
