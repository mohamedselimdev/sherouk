import { useMemo, useState } from "react";
import { Clock, MapPin, Navigation, Phone, Search } from "lucide-react";
import type { Route } from "./+types/branches";
import { BRANCHES } from "~/demo/data";
import { DEFAULT_LOCALE, isLocale } from "~/i18n/config";
import { useT } from "~/i18n/context";
import { btnOutline, btnPrimary, container, DemoBadge, PageHero } from "~/components/ui";

export function meta({ params }: Route.MetaArgs) {
  const lang = isLocale(params.lang) ? params.lang : DEFAULT_LOCALE;
  return [
    { title: `${lang === "ar" ? "الفروع" : "Branches"} | SHROUK` },
    { name: "robots", content: "noindex" },
  ];
}

export default function Branches() {
  const { p, lang } = useT();
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("all");
  const [selected, setSelected] = useState(BRANCHES[0]!.slug);

  const cities = useMemo(() => [...new Set(BRANCHES.map((b) => b.city[lang]))], [lang]);
  const list = BRANCHES.filter((b) => {
    if (city !== "all" && b.city[lang] !== city) return false;
    const hay = `${b.name[lang]} ${b.city[lang]} ${b.address[lang]}`.toLowerCase();
    return !query.trim() || hay.includes(query.trim().toLowerCase());
  });
  const current = list.find((b) => b.slug === selected) ?? list[0];

  return (
    <>
      <PageHero
        eyebrow="BRANCH LOCATOR"
        title={p.branches.title}
        body={p.branches.heroBody}
        image="/assets/backgrounds/cairo-skyline-sunset.webp"
      />
      <div className={`${container} py-8`}>
        <DemoBadge>{p.branches.demoBranches}</DemoBadge>
        <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-2xl font-bold" aria-live="polite">
            {p.branches.count(list.length)}
          </h2>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <label className="relative min-w-0 flex-1 sm:w-72">
              <span className="sr-only">{p.branches.searchPlaceholder}</span>
              <Search
                className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted"
                aria-hidden
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={p.branches.searchPlaceholder}
                className="w-full rounded-input border border-sand bg-surface py-2.5 ps-9 pe-3 text-sm"
              />
            </label>
            <label>
              <span className="sr-only">{p.branches.allCities}</span>
              <select
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="rounded-input border border-sand bg-surface px-3 py-2.5 text-sm"
              >
                <option value="all">{p.branches.allCities}</option>
                {cities.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {list.length === 0 || !current ? (
          <p className="mt-8 rounded-card bg-panel p-8 text-center text-muted">{p.branches.none}</p>
        ) : (
          <div className="mt-6 grid gap-6 lg:grid-cols-[22rem_1fr]">
            <ul className="grid content-start gap-3">
              {list.map((b) => {
                const active = b.slug === current.slug;
                return (
                  <li key={b.slug}>
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => setSelected(b.slug)}
                      className={`flex w-full gap-3 rounded-card border-2 p-3 text-start ${active ? "border-cta bg-panel" : "border-transparent bg-panel hover:border-sand"}`}
                    >
                      <img
                        src={b.image}
                        alt=""
                        loading="lazy"
                        className="size-20 shrink-0 rounded-input object-cover"
                      />
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2 font-semibold">
                          {b.name[lang]}
                          {b.main ? (
                            <span className="rounded bg-cta px-2 py-0.5 text-xs font-medium text-cta-fg">
                              {p.branches.mainBranch}
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-1 block text-sm text-muted">{b.address[lang]}</span>
                        <span className="mt-1 block text-xs text-muted" dir="ltr">
                          {b.phone}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="grid content-start gap-4">
              <section
                className="grid min-h-48 place-items-center rounded-card border border-dashed border-sand bg-panel p-6 text-center"
                aria-label={p.branches.mapTitle}
              >
                <div>
                  <MapPin className="mx-auto size-8 text-cta" aria-hidden />
                  <p className="mt-2 font-semibold">{p.branches.mapTitle}</p>
                  <p className="mt-1 max-w-sm text-sm text-muted">{p.branches.mapPending}</p>
                </div>
              </section>
              <article
                className="grid gap-4 rounded-card bg-panel p-5 sm:grid-cols-[12rem_1fr]"
                aria-live="polite"
              >
                <img src={current.image} alt="" className="aspect-[4/3] w-full rounded-input object-cover" />
                <div>
                  <h3 className="text-xl font-bold">{current.name[lang]}</h3>
                  <p className="mt-2 flex items-start gap-2 text-sm">
                    <MapPin className="mt-0.5 size-4 shrink-0 text-cta" aria-hidden />
                    {current.address[lang]}
                  </p>
                  <p className="mt-2 flex items-center gap-2 text-sm">
                    <Phone className="size-4 text-cta" aria-hidden />
                    <span dir="ltr">{current.phone}</span>
                  </p>
                  <p className="mt-2 flex items-center gap-2 text-sm">
                    <Clock className="size-4 text-cta" aria-hidden />
                    {p.branches.hours}: {current.hours[lang]}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(current.mapQuery)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={btnPrimary}
                    >
                      <Navigation className="size-4" aria-hidden />
                      {p.branches.directions}
                    </a>
                    <a href={`tel:${current.phone.replace(/\s/g, "")}`} className={btnOutline}>
                      <Phone className="size-4" aria-hidden />
                      {p.branches.call}
                    </a>
                  </div>
                </div>
              </article>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
