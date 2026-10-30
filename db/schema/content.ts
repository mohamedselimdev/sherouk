import { sql } from "drizzle-orm";
import { check, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity";

export const postStatus = pgEnum("post_status", ["draft", "published"]);

/**
 * Bilingual blog posts. Bodies are plain text (paragraphs separated by blank lines) and are rendered as text,
 * never as HTML, so editors cannot inject markup. Only `published` rows reach the storefront.
 */
export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slugAr: text("slug_ar").notNull(),
    slugEn: text("slug_en").notNull(),
    category: text("category").notNull(),
    /** Path of a shipped asset or a /media/ key; optional. */
    coverImage: text("cover_image"),
    titleAr: text("title_ar").notNull(),
    titleEn: text("title_en").notNull(),
    excerptAr: text("excerpt_ar").notNull(),
    excerptEn: text("excerpt_en").notNull(),
    bodyAr: text("body_ar").notNull(),
    bodyEn: text("body_en").notNull(),
    status: postStatus("status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("posts_slug_ar_uq").on(t.slugAr),
    uniqueIndex("posts_slug_en_uq").on(t.slugEn),
    check("posts_published_has_date", sql`${t.status} <> 'published' or ${t.publishedAt} is not null`),
  ],
);
