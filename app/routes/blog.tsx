import { Link } from "react-router";
import type { Route } from "./+types/blog";
import { POSTS, POST_CATEGORIES, type DemoPost } from "~/demo/data";
import { DEFAULT_LOCALE, isLocale } from "~/i18n/config";
import { useT } from "~/i18n/context";
import { btnPrimary, container, DemoBadge, EndArrow, PageHero, SectionHeading } from "~/components/ui";

export function loader({ request }: Route.LoaderArgs) {
  const c = new URL(request.url).searchParams.get("c");
  const category = POST_CATEGORIES.find((x) => x.key === c)?.key ?? null;
  return { category };
}

export function meta({ params }: Route.MetaArgs) {
  const lang = isLocale(params.lang) ? params.lang : DEFAULT_LOCALE;
  return [
    { title: `${lang === "ar" ? "المدونة" : "Blog"} | SHROUK` },
    { name: "robots", content: "noindex" },
  ];
}

export default function Blog({ loaderData }: Route.ComponentProps) {
  const { category } = loaderData;
  const { p, lang } = useT();
  const featured = POSTS[0]!;
  const posts = POSTS.filter((x) => !category || x.category === category);
  const catName = (k: DemoPost["category"]) => POST_CATEGORIES.find((c) => c.key === k)?.name[lang] ?? "";

  return (
    <>
      <PageHero
        eyebrow={p.blog.featured}
        title={featured.title[lang]}
        body={featured.excerpt[lang]}
        image="/assets/hero/hero-desktop-text-free.webp"
      >
        <Link to={`/${lang}/blog/${featured.slug}`} className={btnPrimary}>
          {p.blog.readNow}
          <EndArrow className="size-4" />
        </Link>
      </PageHero>
      <div className={`${container} space-y-10 py-8`}>
        <DemoBadge />
        <nav aria-label={p.blog.title}>
          <ul className="flex flex-wrap gap-2">
            <li>
              <Link
                to={`/${lang}/blog`}
                aria-current={!category}
                className={`block rounded-input px-4 py-2 text-sm font-medium ${!category ? "bg-cta text-cta-fg" : "bg-panel hover:bg-sand"}`}
              >
                {p.blog.all}
              </Link>
            </li>
            {POST_CATEGORIES.map((c) => (
              <li key={c.key}>
                <Link
                  to={`/${lang}/blog?c=${c.key}`}
                  aria-current={category === c.key}
                  className={`block rounded-input px-4 py-2 text-sm font-medium ${category === c.key ? "bg-cta text-cta-fg" : "bg-panel hover:bg-sand"}`}
                >
                  {c.name[lang]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <section>
          <SectionHeading title={p.blog.latest} />
          {posts.length === 0 ? (
            <p className="rounded-card bg-panel p-8 text-center text-muted">{p.blog.empty}</p>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {posts.map((post) => (
                <li key={post.slug}>
                  <article className="group relative flex h-full flex-col rounded-card bg-panel p-3">
                    <div className="relative">
                      <img
                        src={post.image}
                        alt=""
                        loading="lazy"
                        className="aspect-[4/3] w-full rounded-input object-cover"
                      />
                      <span className="absolute start-2 top-2 rounded bg-surface/90 px-2 py-0.5 text-xs font-medium text-cta">
                        {catName(post.category)}
                      </span>
                    </div>
                    <h3 className="mt-3 font-semibold">
                      <Link
                        to={`/${lang}/blog/${post.slug}`}
                        className="after:absolute after:inset-0 hover:underline"
                      >
                        {post.title[lang]}
                      </Link>
                    </h3>
                    <p className="mt-1 text-sm text-muted">{post.excerpt[lang]}</p>
                    <span className="mt-auto inline-flex items-center gap-1 pt-3 text-sm font-medium text-cta">
                      {p.blog.readMore}
                      <EndArrow className="size-4" />
                    </span>
                  </article>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-card bg-panel p-6" aria-labelledby="nl-h">
          <h2 id="nl-h" className="text-xl font-bold">
            {p.blog.newsletter}
          </h2>
          <p className="mt-1 text-sm text-muted">{p.blog.newsletterBody}</p>
          <div className="mt-4 flex max-w-md gap-2">
            <input
              type="email"
              disabled
              aria-label="Email"
              dir="ltr"
              className="min-w-0 flex-1 rounded-input border border-sand bg-surface px-3 py-2.5 text-sm disabled:opacity-60"
            />
            <button type="button" disabled className={btnPrimary}>
              {lang === "ar" ? "اشترك الآن" : "Subscribe"}
            </button>
          </div>
        </section>
      </div>
    </>
  );
}
