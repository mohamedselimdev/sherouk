import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { ForbiddenError, loadPrincipal } from "../../server/auth/rbac";
import {
  createPost,
  DuplicateSlugError,
  getPublishedPost,
  listAllPosts,
  listPublishedPosts,
  setPostPublished,
  updatePost,
} from "../../server/content/posts";
import { closeDb, db, makeStaff, reset } from "./helpers";

beforeEach(reset);
afterAll(closeDb);

const input = (over: Record<string, unknown> = {}) => ({
  slugAr: "مقال-تجريبي",
  slugEn: "first-post",
  category: "guide",
  coverImage: "/assets/hero/hero-desktop-text-free.webp",
  titleAr: "عنوان",
  titleEn: "Title",
  excerptAr: "ملخص",
  excerptEn: "Summary",
  bodyAr: "فقرة أولى\n\nفقرة ثانية",
  bodyEn: "First paragraph\n\nSecond paragraph",
  ...over,
});

const editor = async () => loadPrincipal(db, await makeStaff("ed@shrouk.test", "content_editor"));

describe("blog posts", () => {
  it("is refused without content:write", async () => {
    const support = await loadPrincipal(db, await makeStaff("sup@shrouk.test", "customer_support"));
    await expect(createPost(db, support, input())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listAllPosts(db, support)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("keeps drafts off the storefront until published, in either language", async () => {
    const p = await editor();
    const id = await createPost(db, p, input());
    expect(await listPublishedPosts(db)).toHaveLength(0);
    expect(await getPublishedPost(db, "en", "first-post")).toBeNull();

    await setPostPublished(db, p, id, true);
    expect(await listPublishedPosts(db)).toHaveLength(1);
    expect((await getPublishedPost(db, "en", "first-post"))?.title.en).toBe("Title");
    expect((await getPublishedPost(db, "ar", "مقال-تجريبي"))?.title.ar).toBe("عنوان");
    // The slug of the other language does not resolve.
    expect(await getPublishedPost(db, "ar", "first-post")).toBeNull();

    await setPostPublished(db, p, id, false);
    expect(await listPublishedPosts(db)).toHaveLength(0);
  });

  it("keeps the first publish date when republished", async () => {
    const p = await editor();
    const id = await createPost(db, p, input());
    await setPostPublished(db, p, id, true);
    const first = (await listPublishedPosts(db))[0]!.publishedAt;
    await setPostPublished(db, p, id, false);
    await setPostPublished(db, p, id, true);
    expect((await listPublishedPosts(db))[0]!.publishedAt).toEqual(first);
  });

  it("rejects bad slugs, categories and cover paths", async () => {
    const p = await editor();
    for (const bad of [
      input({ slugEn: "Has Spaces" }),
      input({ slugEn: "bad/slash" }),
      input({ category: "unknown" }),
      input({ coverImage: "https://evil.example/x.png" }),
      input({ coverImage: "/assets/../secret" }),
      input({ titleEn: "   " }),
    ]) {
      await expect(createPost(db, p, bad)).rejects.toBeInstanceOf(ZodError);
    }
    expect(await listAllPosts(db, p)).toHaveLength(0);
  });

  it("refuses duplicate slugs on create and update", async () => {
    const p = await editor();
    await createPost(db, p, input());
    await expect(createPost(db, p, input())).rejects.toBeInstanceOf(DuplicateSlugError);
    const other = await createPost(db, p, input({ slugAr: "اخر", slugEn: "second-post" }));
    await expect(updatePost(db, p, other, input())).rejects.toBeInstanceOf(DuplicateSlugError);
    await updatePost(db, p, other, input({ slugAr: "اخر", slugEn: "second-post", titleEn: "Changed" }));
    expect((await listAllPosts(db, p)).some((r) => r.titleEn === "Changed")).toBe(true);
  });
});
