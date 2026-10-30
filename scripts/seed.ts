/**
 * Idempotent development seed: roles/permissions, demo catalog, demo branches and the first HQ admin.
 *   DATABASE_URL  target database (defaults to the local dev database)
 *   SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD  from .dev.vars; the admin is only created if no staff exist
 * Never run against production: the demo catalog is placeholder data.
 */
import { readFileSync, existsSync } from "node:fs";
import { eq, inArray } from "drizzle-orm";
import { createDb } from "../server/db";
import { ROLE_DEFS, syncRolesAndPermissions } from "../server/auth/rbac";
import { hashPassword } from "../server/security/crypto";
import {
  branchHours,
  branchTranslations,
  branches,
  categories,
  categoryTranslations,
  media,
  productTranslations,
  productVariants,
  products,
  roleAssignments,
  roles,
  users,
} from "../db/schema";
import { branchInventory, coupons, shippingRates, stockMovements } from "../db/schema";
import { GOVERNORATES } from "../server/fulfillment/governorates";
import { DEMO_BRANCHES, DEMO_CATEGORIES, DEMO_PRODUCTS } from "../db/seed/demo-catalog";

function devVar(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  if (!existsSync(".dev.vars")) return undefined;
  const line = readFileSync(".dev.vars", "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${name}=`));
  return line
    ?.slice(name.length + 1)
    .trim()
    .replace(/^"|"$/g, "");
}

const url = process.env.DATABASE_URL ?? "postgres://shrouk:shrouk_local_only@127.0.0.1:54329/shrouk_dev";
if (!/127\.0\.0\.1|localhost/.test(url) && process.env.ALLOW_REMOTE_SEED !== "1") {
  throw new Error("Refusing to seed a non-local database (set ALLOW_REMOTE_SEED=1 only for staging).");
}

const { db, close } = createDb(url, 2);
await syncRolesAndPermissions(db);

for (const c of DEMO_CATEGORIES) {
  const [row] = await db
    .insert(categories)
    .values({ key: c.key, sortOrder: c.sortOrder })
    .onConflictDoNothing()
    .returning({ id: categories.id });
  if (row)
    await db.insert(categoryTranslations).values([
      { categoryId: row.id, locale: "ar", ...c.ar },
      { categoryId: row.id, locale: "en", ...c.en },
    ]);
}

for (const p of DEMO_PRODUCTS) {
  const [cat] = await db.select({ id: categories.id }).from(categories).where(eq(categories.key, p.category));
  const exists = await db
    .select({ id: productTranslations.productId })
    .from(productTranslations)
    .where(eq(productTranslations.slug, p.slug))
    .limit(1);
  if (exists.length) continue;
  const [row] = await db
    .insert(products)
    .values({
      categoryId: cat!.id,
      status: "published",
      frameShape: p.shape,
      featured: !!p.featured,
      publishedAt: new Date(),
    })
    .returning({ id: products.id });
  await db.insert(productTranslations).values([
    { productId: row!.id, locale: "ar", name: p.ar.name, subtitle: p.ar.sub, slug: p.slug },
    { productId: row!.id, locale: "en", name: p.en.name, subtitle: p.en.sub, slug: p.slug },
  ]);
  await db.insert(productVariants).values(
    p.colors.map((colorKey, i) => ({
      productId: row!.id,
      sku: `DEMO-${p.slug.toUpperCase()}-${colorKey.toUpperCase()}`.slice(0, 40),
      colorKey,
      pricePiasters: p.price * 100,
      compareAtPiasters: p.oldPrice ? p.oldPrice * 100 : null,
      sortOrder: i,
    })),
  );
  await db.insert(media).values({
    productId: row!.id,
    r2Key: p.image,
    contentType: "image/webp",
    bytes: 1,
    altAr: p.ar.name,
    altEn: p.en.name,
  });
}

for (const b of DEMO_BRANCHES) {
  const [row] = await db
    .insert(branches)
    .values({ slug: b.slug, phone: b.phone, verified: false })
    .onConflictDoNothing()
    .returning({ id: branches.id });
  if (!row) continue;
  await db.insert(branchTranslations).values([
    { branchId: row.id, locale: "ar", ...b.ar },
    { branchId: row.id, locale: "en", ...b.en },
  ]);
  await db.insert(branchHours).values(
    Array.from({ length: 7 }, (_, weekday) => ({
      branchId: row.id,
      weekday,
      opensAt: "10:00",
      closesAt: "23:00",
      closed: false,
    })),
  );
}

// Demo commerce data: shipping rates (placeholder fees, pending business input), online fulfilment, stock, a demo coupon.
await db
  .update(branches)
  .set({ fulfilsOnline: true, pickupEnabled: true })
  .where(
    inArray(
      branches.slug,
      DEMO_BRANCHES.map((b) => b.slug),
    ),
  );
for (const g of GOVERNORATES) {
  await db
    .insert(shippingRates)
    .values({
      governorate: g.key,
      feePiasters: g.key === "cairo" || g.key === "giza" ? 7000 : 10000,
      freeOverPiasters: 500000,
    })
    .onConflictDoNothing();
}
const demoBranchRows = await db
  .select({ id: branches.id })
  .from(branches)
  .where(
    inArray(
      branches.slug,
      DEMO_BRANCHES.map((x) => x.slug),
    ),
  );
const demoVariants = await db.select({ id: productVariants.id }).from(productVariants);
for (const branch of demoBranchRows) {
  for (const v of demoVariants) {
    const inserted = await db
      .insert(branchInventory)
      .values({ branchId: branch.id, variantId: v.id, onHand: 20 })
      .onConflictDoNothing()
      .returning({ id: branchInventory.variantId });
    if (inserted.length)
      await db.insert(stockMovements).values({
        branchId: branch.id,
        variantId: v.id,
        type: "receipt",
        quantity: 20,
        reason: "demo opening stock",
      });
  }
}
await db.insert(coupons).values({ code: "WELCOME10", type: "percent", value: 1000 }).onConflictDoNothing();

const existingStaff = await db.select({ id: users.id }).from(users).limit(1);
const email = devVar("SEED_ADMIN_EMAIL");
const password = devVar("SEED_ADMIN_PASSWORD");
if (!existingStaff.length && email && password) {
  const [u] = await db
    .insert(users)
    .values({
      email: email.toLowerCase(),
      displayName: "HQ Admin",
      passwordHash: await hashPassword(password),
    })
    .returning({ id: users.id });
  const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, "hq_admin"));
  await db.insert(roleAssignments).values({ userId: u!.id, roleId: role!.id });
  console.log(`created HQ admin ${email} (MFA is enrolled at first login)`);
} else if (!existingStaff.length) {
  console.log(
    "no staff exist and SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD are not set: run `npm run dev:init` first",
  );
}

console.log(
  `seed ok: ${Object.keys(ROLE_DEFS).length} roles, ${DEMO_CATEGORIES.length} categories, ${DEMO_PRODUCTS.length} products`,
);
await close();
