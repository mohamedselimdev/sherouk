import { Link } from "react-router";
import { Eye, Gem, Target, Headset, ShieldCheck, Glasses, ThumbsUp } from "lucide-react";
import type { Route } from "./+types/about";
import { DEFAULT_LOCALE, isLocale } from "~/i18n/config";
import { useT } from "~/i18n/context";
import { btnOutline, btnPrimary, container, DemoBadge, PageHero } from "~/components/ui";

export function meta({ params }: Route.MetaArgs) {
  const lang = isLocale(params.lang) ? params.lang : DEFAULT_LOCALE;
  return [
    { title: `${lang === "ar" ? "من نحن" : "About"} | SHROUK` },
    { name: "robots", content: "noindex" },
  ];
}

const VALUE_ICONS = [Gem, Eye, Target];
const WHY_ICONS = [Headset, ShieldCheck, Glasses, ThumbsUp];

export default function About() {
  const { p, lang } = useT();
  return (
    <>
      <PageHero
        eyebrow={p.about.eyebrow}
        title={p.about.heroTitle}
        body={p.about.heroBody}
        image="/assets/hero/hero-desktop-text-free.webp"
      >
        <Link to={`/${lang}/shop`} className={btnPrimary}>
          {p.about.ctaShop}
        </Link>
      </PageHero>
      <div className={`${container} space-y-12 py-10`}>
        <DemoBadge />
        <section className="grid items-center gap-6 md:grid-cols-[1fr_1.2fr]">
          <img
            src="/assets/products/photographic-previews/tortoise-square-reference-crop.webp"
            alt=""
            loading="lazy"
            className="aspect-[4/3] w-full rounded-card object-cover"
          />
          <div>
            <h2 className="text-2xl font-bold">{p.about.storyTitle}</h2>
            <p className="mt-3 text-muted">{p.about.storyBody}</p>
          </div>
        </section>
        <ul className="grid gap-4 md:grid-cols-3">
          {p.about.values.map((v, i) => {
            const Icon = VALUE_ICONS[i] ?? Gem;
            return (
              <li key={v.title} className="rounded-card bg-panel p-6 text-center">
                <Icon className="mx-auto size-9 text-cta" aria-hidden />
                <h3 className="mt-3 text-lg font-bold">{v.title}</h3>
                <p className="mt-1 text-sm text-muted">{v.body}</p>
              </li>
            );
          })}
        </ul>
        <p className="rounded-card border border-dashed border-sand p-4 text-center text-sm text-muted">
          {p.about.statsNote}
        </p>
        <section>
          <h2 className="mb-5 text-center text-2xl font-bold">{p.about.whyTitle}</h2>
          <ul className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {p.about.why.map((w, i) => {
              const Icon = WHY_ICONS[i] ?? ThumbsUp;
              return (
                <li key={w} className="flex flex-col items-center gap-2 text-center">
                  <Icon className="size-9 text-cta" aria-hidden />
                  <span className="text-sm font-semibold">{w}</span>
                </li>
              );
            })}
          </ul>
        </section>
        <section className="relative isolate overflow-hidden rounded-card bg-[#f1e8df] p-8 text-[#171514]">
          <img
            src="/assets/lifestyle/portrait-man-editorial.webp"
            alt=""
            loading="lazy"
            className="absolute inset-0 -z-10 size-full object-cover object-right"
          />
          <div className="absolute inset-0 -z-10 bg-gradient-to-r from-[#f1e8df] via-[#f1e8df]/85 to-transparent" />
          <div className="mr-auto max-w-sm">
            <h2 className="text-2xl font-bold">{p.about.ctaTitle}</h2>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link to={`/${lang}/shop`} className={btnPrimary}>
                {p.about.ctaShop}
              </Link>
              <Link to={`/${lang}/branches`} className={`${btnOutline} bg-white/60`}>
                {p.about.ctaBranch}
              </Link>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
