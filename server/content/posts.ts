import { and, desc, eq, isNotNull, lte } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db";
import { posts } from "../../db/schema";
import { audit } from "../audit";
import { requirePermission, type Principal } from "../auth/rbac";
import { NotFoundError } from "../catalog/admin";

export const POST_CATEGORY_KEYS = ["lifestyle", "lenses", "fashion", "guide", "eye-care"] as const;
export type PostCategory = (typeof POST_CATEGORY_KEYS)[number];

export class DuplicateSlugError extends Error {
  constructor() {
    super("Post slug already exists");
    this.name = "DuplicateSlugError";
  }
}

type L10n = { ar: string; en: string };

export type PublicPost = {
  id: string;
  slug: L10n;
  category: PostCategory;
  image: string | null;
  title: L10n;
  excerpt: L10n;
  body: L10n;
  publishedAt: Date;
};

const toPublic = (r: typeof posts.$inferSelect): PublicPost => ({
  id: r.id,
  slug: { ar: r.slugAr, en: r.slugEn },
  category: r.category as PostCategory,
  image: r.coverImage,
  title: { ar: r.titleAr, en: r.titleEn },
  excerpt: { ar: r.excerptAr, en: r.excerptEn },
  body: { ar: r.bodyAr, en: r.bodyEn },
  publishedAt: r.publishedAt!,
});

/** Evaluated per call so the cut-off is the current time, not the time the module loaded. */
const live = () =>
  and(eq(posts.status, "published"), isNotNull(posts.publishedAt), lte(posts.publishedAt, new Date()));

/** Published posts only, newest first. */
export async function listPublishedPosts(db: Db): Promise<PublicPost[]> {
  const rows = await db.select().from(posts).where(live()).orderBy(desc(posts.publishedAt));
  return rows.map(toPublic);
}

export async function getPublishedPost(db: Db, lang: "ar" | "en", slug: string): Promise<PublicPost | null> {
  const [row] = await db
    .select()
    .from(posts)
    .where(and(live(), eq(lang === "ar" ? posts.slugAr : posts.slugEn, slug)))
    .limit(1);
  return row ? toPublic(row) : null;
}

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .max(80)
  .regex(/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u);
const text = (max: number) => z.string().trim().min(1).max(max);
/** A shipped asset path or an uploaded /media/ path; never an external URL. */
const cover = z
  .string()
  .trim()
  .max(300)
  .regex(/^\/(assets|media)\/[A-Za-z0-9._\-/]+$/)
  .refine((v) => !v.includes("..") && !v.includes("//"))
  .or(z.literal(""))
  .transform((v) => (v === "" ? null : v));

const postInput = z.object({
  slugAr: slug,
  slugEn: slug,
  category: z.enum(POST_CATEGORY_KEYS),
  coverImage: cover.default(null),
  titleAr: text(160),
  titleEn: text(160),
  excerptAr: text(300),
  excerptEn: text(300),
  bodyAr: text(20000),
  bodyEn: text(20000),
});

function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } };
  return err.code === "23505" || err.cause?.code === "23505";
}

export async function listAllPosts(db: Db, principal: Principal) {
  requirePermission(principal, "content:write", null);
  return db.select().from(posts).orderBy(desc(posts.updatedAt));
}

export async function getPostForEdit(db: Db, principal: Principal, id: string) {
  requirePermission(principal, "content:write", null);
  const [row] = await db.select().from(posts).where(eq(posts.id, id));
  if (!row) throw new NotFoundError("Post not found");
  return row;
}

export async function createPost(db: Db, principal: Principal, raw: unknown): Promise<string> {
  requirePermission(principal, "content:write", null);
  const p = postInput.parse(raw);
  try {
    const [row] = await db
      .insert(posts)
      .values({ ...p, authorId: principal.userId })
      .returning({ id: posts.id });
    await audit(db, {
      actorId: principal.userId,
      action: "post.created",
      entityType: "post",
      entityId: row!.id,
    });
    return row!.id;
  } catch (e) {
    if (isUniqueViolation(e)) throw new DuplicateSlugError();
    throw e;
  }
}

export async function updatePost(db: Db, principal: Principal, id: string, raw: unknown): Promise<void> {
  requirePermission(principal, "content:write", null);
  const p = postInput.parse(raw);
  try {
    const [row] = await db
      .update(posts)
      .set({ ...p, updatedAt: new Date() })
      .where(eq(posts.id, id))
      .returning({ id: posts.id });
    if (!row) throw new NotFoundError("Post not found");
  } catch (e) {
    if (isUniqueViolation(e)) throw new DuplicateSlugError();
    throw e;
  }
  await audit(db, { actorId: principal.userId, action: "post.updated", entityType: "post", entityId: id });
}

/** Publishing keeps the first publish date; unpublishing returns the post to draft. */
export async function setPostPublished(
  db: Db,
  principal: Principal,
  id: string,
  published: boolean,
): Promise<void> {
  requirePermission(principal, "content:write", null);
  const current = await getPostForEdit(db, principal, id);
  await db
    .update(posts)
    .set({
      status: published ? "published" : "draft",
      publishedAt: published ? (current.publishedAt ?? new Date()) : current.publishedAt,
      updatedAt: new Date(),
    })
    .where(eq(posts.id, id));
  await audit(db, {
    actorId: principal.userId,
    action: published ? "post.published" : "post.unpublished",
    entityType: "post",
    entityId: id,
  });
}
