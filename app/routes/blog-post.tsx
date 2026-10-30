import { data, Link } from "react-router";
import type { Route } from "./+types/blog-post";
import { POST_CATEGORIES } from "~/demo/data";
import { DEFAULT_LOCALE, isLocale } from "~/i18n/config";
import { useT } from "~/i18n/context";
import { breadcrumbJsonLd, pageMeta, siteOrigin } from "~/lib/seo";
import { Breadcrumbs, container, EndArrow } from "~/components/ui";
import { getPublishedPost } from "../../server/content/posts";
import { getScope } from "../../server/http/session";

export async function loader({ params, context }: Route.LoaderArgs) {
  const scope = getScope(context);
  const lang = isLocale(params.lang) ? params.lang : DEFAULT_LOCALE;
  const post = await getPublishedPost(scope.catalogDb, lang, params.slug);
  if (!post) throw data(null, { status: 404 });
  return {
    siteUrl: siteOrigin(scope.env.SITE_URL),
    index: scope.env.APP_ENV === "production",
    post,
  };
}

export function meta({ loaderData: d, params }: Route.MetaArgs) {
  const lang = isLocale(params.lang) ? params.lang : DEFAULT_LOCALE;
  if (!d) return [{ title: "SHROUK" }, { name: "robots", content: "noindex" }];
  const { post, siteUrl } = d;
  const paths = { ar: `/ar/blog/${post.slug.ar}`, en: `/en/blog/${post.slug.en}` };
  return pageMeta({
    siteUrl,
    index: d.index,
    lang,
    paths,
    title: `${post.title[lang]} | SHROUK`,
    description: post.excerpt[lang],
    image: post.image,
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        headline: post.title[lang],
        description: post.excerpt[lang],
        inLanguage: lang === "ar" ? "ar-EG" : "en-EG",
        datePublished: new Date(post.publishedAt).toISOString(),
        mainEntityOfPage: siteUrl + paths[lang],
        publisher: { "@type": "Organization", name: "SHROUK" },
      },
      breadcrumbJsonLd([
        { name: lang === "ar" ? "الرئيسية" : "Home", url: `${siteUrl}/${lang}` },
        { name: lang === "ar" ? "المدونة" : "Blog", url: `${siteUrl}/${lang}/blog` },
        { name: post.title[lang], url: siteUrl + paths[lang] },
      ]),
    ],
  });
}

export default function BlogPost({ loaderData }: Route.ComponentProps) {
  const { post } = loaderData;
  const { p, lang } = useT();
  const cat = POST_CATEGORIES.find((c) => c.key === post.category);
  // Plain text only: paragraphs split on blank lines and rendered as text nodes.
  const paragraphs = post.body[lang]
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
  return (
    <article className={`${container} max-w-3xl py-8`}>
      <Breadcrumbs
        items={[
          { label: p.common.home, to: `/${lang}` },
          { label: p.blog.title, to: `/${lang}/blog` },
          { label: post.title[lang] },
        ]}
      />
      <p className="mt-6 text-sm font-semibold text-cta">{cat?.name[lang]}</p>
      <h1 className="mt-1 text-3xl font-bold leading-tight sm:text-4xl">{post.title[lang]}</h1>
      {post.image ? (
        <img src={post.image} alt="" className="mt-6 aspect-[16/9] w-full rounded-card object-cover" />
      ) : null}
      <p className="mt-6 text-lg text-muted">{post.excerpt[lang]}</p>
      {paragraphs.map((t, i) => (
        <p key={i} className="mt-4 whitespace-pre-line leading-8">
          {t}
        </p>
      ))}
      <Link
        to={`/${lang}/blog`}
        className="mt-8 inline-flex items-center gap-1 font-medium text-cta hover:underline"
      >
        <EndArrow className="size-4 rotate-180" />
        {p.blog.back}
      </Link>
    </article>
  );
}
