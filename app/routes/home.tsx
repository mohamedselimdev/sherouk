import { Link } from "react-router";
import { motion, useReducedMotion } from "motion/react";
import { MapPin } from "lucide-react";
import type { Route } from "./+types/home";
import { dictionaries } from "~/i18n/dictionary";
import { DEFAULT_LOCALE, isLocale } from "~/i18n/config";
import { useT } from "~/i18n/context";
import { listStoreCategories, listStoreProducts } from "../../server/catalog/store";
import { getScope } from "../../server/http/session";
import { pageMeta, siteOrigin } from "~/lib/seo";
import {
  btnPrimary,
  container,
  DemoBadge,
  EndArrow,
  ProductCard,
  ProductImage,
  SectionHeading,
  TrustStrip,
} from "~/components/ui";

export function meta({ loaderData: d, params }: Route.MetaArgs) {
  const lang = isLocale(params.lang) ? params.lang : DEFAULT_LOCALE;
  return pageMeta({
    siteUrl: d?.siteUrl ?? "",
    index: d?.index ?? false,
    lang,
    paths: { ar: "/ar", en: "/en" },
    title: dictionaries[lang].home.title,
  });
}

const CATEGORY_FALLBACK_IMAGE: Record<string, string> = {
  lenses: "/assets/lifestyle/contact-lens-scene.webp",
};

export async function loader({ context, params }: Route.LoaderArgs) {
  const lang = isLocale(params.lang) ? params.lang : DEFAULT_LOCALE;
  const scope = getScope(context);
  const db = scope.catalogDb;
  const [categories, products] = await Promise.all([listStoreCategories(db, lang), listStoreProducts(db)]);
  const bestSellers = [...products]
    .sort((a, b) => Number(b.featured) - Number(a.featured) || Number(!!b.oldPrice) - Number(!!a.oldPrice))
    .slice(0, 4);
  return {
    siteUrl: siteOrigin(scope.env.SITE_URL),
    index: scope.env.APP_ENV === "production",
    bestSellers,
    categories: categories.map((c) => ({
      ...c,
      image: products.find((x) => x.category === c.key)?.image ?? CATEGORY_FALLBACK_IMAGE[c.key] ?? null,
    })),
  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { p, lang } = useT();
  const reduce = useReducedMotion();
  return (
    <>
      <section className="relative isolate overflow-hidden bg-[#f1e8df] text-[#171514]">
        <picture>
          <source media="(min-width: 640px)" srcSet="/assets/hero/hero-desktop-text-free.webp" />
          <img
            src="/assets/hero/hero-mobile-text-free.webp"
            alt=""
            fetchPriority="high"
            width={840}
            height={1160}
            className="absolute inset-0 -z-10 size-full object-cover object-[75%_20%] sm:object-right"
          />
        </picture>
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-[#f1e8df]/95 via-[#f1e8df]/60 to-transparent sm:from-[#f1e8df] sm:via-[#f1e8df]/70" />
        <div
          className={`${container} flex min-h-[26rem] items-center py-12 sm:min-h-[30rem] lg:min-h-[34rem]`}
        >
          <motion.div
            className="mr-auto max-w-md"
            initial={reduce ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          >
            <h1 className="text-4xl font-bold leading-tight sm:text-5xl lg:text-6xl">{p.home.heroTitle}</h1>
            <p className="mt-4 text-base text-[#4b2e23] sm:text-lg">{p.home.heroBody}</p>
            <Link to={`/${lang}/shop`} className={`${btnPrimary} mt-6`}>
              {p.home.heroCta}
              <EndArrow className="size-4" />
            </Link>
          </motion.div>
        </div>
      </section>

      <div className={`${container} space-y-12 py-8 sm:py-10`}>
        <DemoBadge />

        <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {loaderData.categories.map((c) => (
            <li key={c.key}>
              <Link
                to={`/${lang}/c/${c.key}`}
                className="group flex h-full flex-col rounded-card bg-panel p-3 transition hover:shadow-soft"
              >
                <ProductImage src={c.image} />
                <span className="mt-3 flex items-center justify-between gap-2">
                  <span>
                    <span className="block font-semibold">{c.name}</span>
                    <span className="block text-xs text-muted">{c.blurb}</span>
                  </span>
                  <EndArrow className="size-5 shrink-0 text-cta transition group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" />
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <TrustStrip />

        <section>
          <SectionHeading title={p.home.bestSellers} href={`/${lang}/shop`} linkLabel={p.common.viewAll} />
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {loaderData.bestSellers.map((product) => (
              <li key={product.id}>
                <ProductCard product={product} />
              </li>
            ))}
          </ul>
        </section>

        <div className="grid gap-4 md:grid-cols-2">
          <section className="relative isolate overflow-hidden rounded-card bg-[#f1e8df] p-6 text-[#171514] sm:p-8">
            <img
              src="/assets/lifestyle/portrait-man-editorial.webp"
              alt=""
              loading="lazy"
              className="absolute inset-0 -z-10 size-full object-cover object-right"
            />
            <div className="absolute inset-0 -z-10 bg-gradient-to-r from-[#f1e8df] via-[#f1e8df]/80 to-transparent" />
            <div className="mr-auto max-w-xs">
              <h2 className="text-2xl font-bold">{p.home.storyTitle}</h2>
              <p className="mt-2 text-sm text-[#4b2e23]">{p.home.storyBody}</p>
              <Link
                to={`/${lang}/about`}
                className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[#b94e25] hover:underline"
              >
                {p.home.storyCta}
                <EndArrow className="size-4" />
              </Link>
            </div>
          </section>
          <section className="relative isolate overflow-hidden rounded-card bg-[#3a2418] p-6 text-white sm:p-8">
            <img
              src="/assets/backgrounds/cairo-skyline-sunset.webp"
              alt=""
              loading="lazy"
              className="absolute inset-0 -z-10 size-full object-cover"
            />
            <div className="absolute inset-0 -z-10 bg-black/45" />
            <h2 className="text-2xl font-bold">{p.home.branchesTitle}</h2>
            <p className="mt-2 max-w-xs text-sm opacity-90">{p.home.branchesBody}</p>
            <Link to={`/${lang}/branches`} className={`${btnPrimary} mt-4`}>
              <MapPin className="size-4" aria-hidden />
              {p.home.branchesCta}
            </Link>
          </section>
        </div>
      </div>
    </>
  );
}
