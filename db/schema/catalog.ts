import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity";

export const productStatus = pgEnum("product_status", ["draft", "published", "archived"]);

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  sortOrder: integer("sort_order").notNull().default(0),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

export const categoryTranslations = pgTable(
  "category_translations",
  {
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    locale: text("locale").notNull(),
    name: text("name").notNull(),
    blurb: text("blurb"),
  },
  (t) => [
    primaryKey({ columns: [t.categoryId, t.locale] }),
    check("cat_tr_locale_chk", sql`${t.locale} in ('ar','en')`),
  ],
);

export const brands = pgTable("brands", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "set null" }),
    status: productStatus("status").notNull().default("draft"),
    frameShape: text("frame_shape"),
    featured: boolean("featured").notNull().default(false),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("products_category_idx").on(t.categoryId, t.status),
    check(
      "products_shape_chk",
      sql`${t.frameShape} is null or ${t.frameShape} in ('round','square','aviator','cat-eye','sport')`,
    ),
  ],
);

export const productTranslations = pgTable(
  "product_translations",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    locale: text("locale").notNull(),
    name: text("name").notNull(),
    subtitle: text("subtitle"),
    description: text("description"),
    slug: text("slug").notNull(),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.locale] }),
    uniqueIndex("product_tr_slug_uq").on(t.locale, t.slug),
    check("product_tr_locale_chk", sql`${t.locale} in ('ar','en')`),
  ],
);

/** Money is integer piasters (1 EGP = 100). Never floats. */
export const productVariants = pgTable(
  "product_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    sku: text("sku").notNull().unique(),
    colorKey: text("color_key").notNull(),
    pricePiasters: integer("price_piasters").notNull(),
    compareAtPiasters: integer("compare_at_piasters"),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    index("variants_product_idx").on(t.productId),
    check("variants_price_chk", sql`${t.pricePiasters} >= 0`),
    check(
      "variants_compare_chk",
      sql`${t.compareAtPiasters} is null or ${t.compareAtPiasters} > ${t.pricePiasters}`,
    ),
  ],
);

export const media = pgTable(
  "media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id").references(() => products.id, { onDelete: "cascade" }),
    /** Random object key in R2; never derived from the uploaded filename. */
    r2Key: text("r2_key").notNull().unique(),
    contentType: text("content_type").notNull(),
    bytes: integer("bytes").notNull(),
    altAr: text("alt_ar"),
    altEn: text("alt_en"),
    sortOrder: integer("sort_order").notNull().default(0),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("media_product_idx").on(t.productId), check("media_bytes_chk", sql`${t.bytes} > 0`)],
);
