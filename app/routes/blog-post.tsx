import { data, Link } from "react-router";
import type { Route } from "./+types/blog-post";
import { postBySlug, POST_CATEGORIES } from "~/demo/data";
import { DEFAULT_LOCALE, isLocale } from "~/i18n/config";
import { useT } from "~/i18n/context";
import { Breadcrumbs, container, DemoBadge, EndArrow } from "~/components/ui";

export function loader({ params }: Route.LoaderArgs) {
  const post = postBySlug(params.slug);
  if (!post) throw data(null, { status: 404 });
  return { post };
}

export function meta({ loaderData: d, params }: Route.MetaArgs) {
  const lang = isLocale(params.lang) ? params.lang : DEFAULT_LOCALE;
  return [{ title: `${d?.post.title[lang] ?? ""} | SHROUK` }, { name: "robots", content: "noindex" }];
}

export default function BlogPost({ loaderData }: Route.ComponentProps) {
  const { post } = loaderData;
  const { p, lang } = useT();
  const cat = POST_CATEGORIES.find((c) => c.key === post.category);
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
      <div className="mt-3">
        <DemoBadge />
      </div>
      <img src={post.image} alt="" className="mt-6 aspect-[16/9] w-full rounded-card object-cover" />
      <p className="mt-6 text-lg text-muted">{post.excerpt[lang]}</p>
      <p className="mt-4">{p.blog.articleDemo}</p>
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
