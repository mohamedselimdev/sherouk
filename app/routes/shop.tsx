import { useEffect, useRef, useState } from "react";
import { data, Form, Link, useSearchParams } from "react-router";
import { LayoutGrid, List, SlidersHorizontal, X } from "lucide-react";
import type { Route } from "./+types/shop";
import { COLORS, type ColorKey } from "~/demo/data";
import { listStoreCategories, listStoreProducts, type StoreCategory } from "../../server/catalog/store";
import { getScope } from "../../server/http/session";
import { pageMeta, siteOrigin } from "~/lib/seo";
import { DEFAULT_LOCALE, isLocale } from "~/i18n/config";
import { dictionaries } from "~/i18n/dictionary";
import { useT } from "~/i18n/context";
import { btnOutline, btnPrimary, Breadcrumbs, container, DemoBadge, ProductCard } from "~/components/ui";

const SORTS = ["featured", "price-asc", "price-desc"] as const;
type Sort = (typeof SORTS)[number];
const SHAPES = ["round", "square", "aviator", "cat-eye", "sport"] as const;

function num(value: string | null): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const lang = url.pathname.split("/")[1];
  const locale = isLocale(lang) ? lang : DEFAULT_LOCALE;
  const scope = getScope(context);
  const db = scope.catalogDb;
  const [categories, all] = await Promise.all([listStoreCategories(db, locale), listStoreProducts(db)]);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
  const category = params.category;
  if (category && !categories.some((c) => c.key === category)) throw data(null, { status: 404 });
  const cats = url.searchParams.getAll("cat").filter((c) => categories.some((x) => x.key === c));
  const colors = url.searchParams.getAll("color").filter((c): c is ColorKey => c in COLORS);
  const shapes = url.searchParams.getAll("shape").filter((s) => (SHAPES as readonly string[]).includes(s));
  const min = num(url.searchParams.get("min"));
  const max = num(url.searchParams.get("max"));
  const sortParam = url.searchParams.get("sort");
  const sort: Sort = (SORTS as readonly string[]).includes(sortParam ?? "")
    ? (sortParam as Sort)
    : "featured";
  const view = url.searchParams.get("view") === "list" ? "list" : "grid";

  let items = all.filter((p) => {
    if (category && p.category !== category) return false;
    if (cats.length && !cats.includes(p.category)) return false;
    if (colors.length && !p.colors.some((c) => (colors as string[]).includes(c.colorKey))) return false;
    if (shapes.length && !(p.shape && shapes.includes(p.shape))) return false;
    if (min !== undefined && p.price < min * 100) return false;
    if (max !== undefined && p.price > max * 100) return false;
    if (q && !`${p.name.ar} ${p.name.en}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });
  if (sort === "price-asc") items = [...items].sort((a, b) => a.price - b.price);
  if (sort === "price-desc") items = [...items].sort((a, b) => b.price - a.price);
  if (sort === "featured") items = [...items].sort((a, b) => Number(b.featured) - Number(a.featured));
  return {
    siteUrl: siteOrigin(scope.env.SITE_URL),
    index: scope.env.APP_ENV === "production",
    items,
    category: category ?? null,
    categories,
    q,
    sort,
    view,
    locale,
  };
}

export function meta({ loaderData: d }: Route.MetaArgs) {
  const lang = d?.locale ?? DEFAULT_LOCALE;
  const cat = d?.categories.find((c) => c.key === d?.category);
  const title = cat ? cat.name : lang === "ar" ? "المتجر" : "Shop";
  const path = (l: string) => (d?.category ? `/${l}/c/${d.category}` : `/${l}/shop`);
  return pageMeta({
    siteUrl: d?.siteUrl ?? "",
    index: d?.index ?? false,
    lang,
    paths: { ar: path("ar"), en: path("en") },
    title: `${title} | ${dictionaries[lang].brandEn}`,
    description: cat?.blurb || undefined,
  });
}

function FilterForm({
  category,
  categories,
  onDone,
}: {
  category: string | null;
  categories: StoreCategory[];
  onDone?: () => void;
}) {
  const { p, lang } = useT();
  const [params] = useSearchParams();
  const has = (k: string, v: string) => params.getAll(k).includes(v);
  const box = "size-4 accent-[var(--cta)]";
  return (
    <Form method="get" onSubmit={onDone} className="space-y-6">
      {params.get("q") ? <input type="hidden" name="q" value={params.get("q")!} /> : null}
      {params.get("view") ? <input type="hidden" name="view" value={params.get("view")!} /> : null}
      {params.get("sort") ? <input type="hidden" name="sort" value={params.get("sort")!} /> : null}
      {!category ? (
        <fieldset>
          <legend className="mb-2 font-semibold">{p.shop.category}</legend>
          <div className="space-y-2">
            {categories.map((c) => (
              <label key={c.key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="cat"
                  value={c.key}
                  defaultChecked={has("cat", c.key)}
                  className={box}
                />
                {c.name}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <fieldset>
        <legend className="mb-2 font-semibold">{p.shop.price}</legend>
        <div className="flex items-center gap-2">
          <label className="flex-1 text-xs text-muted">
            {p.shop.priceMin}
            <input
              name="min"
              type="number"
              inputMode="numeric"
              min={0}
              step={50}
              defaultValue={params.get("min") ?? ""}
              className="mt-1 w-full rounded-input border border-sand bg-surface px-2 py-2 text-sm text-fg"
            />
          </label>
          <label className="flex-1 text-xs text-muted">
            {p.shop.priceMax}
            <input
              name="max"
              type="number"
              inputMode="numeric"
              min={0}
              step={50}
              defaultValue={params.get("max") ?? ""}
              className="mt-1 w-full rounded-input border border-sand bg-surface px-2 py-2 text-sm text-fg"
            />
          </label>
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 font-semibold">{p.shop.frameColor}</legend>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(COLORS) as ColorKey[]).map((c) => (
            <label key={c} className="relative cursor-pointer" title={COLORS[c].name[lang]}>
              <input
                type="checkbox"
                name="color"
                value={c}
                defaultChecked={has("color", c)}
                className="peer sr-only"
              />
              <span
                className="block size-7 rounded-full border border-black/20 peer-checked:ring-2 peer-checked:ring-cta peer-checked:ring-offset-2 peer-checked:ring-offset-surface peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-cta"
                style={{ background: COLORS[c].hex }}
              />
              <span className="sr-only">{COLORS[c].name[lang]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 font-semibold">{p.shop.frameShape}</legend>
        <div className="space-y-2">
          {SHAPES.map((s) => (
            <label key={s} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="shape"
                value={s}
                defaultChecked={has("shape", s)}
                className={box}
              />
              {p.shop.shapes[s]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex gap-2">
        <button type="submit" className={`${btnPrimary} flex-1`}>
          {p.shop.apply}
        </button>
        <Link
          to={category ? `/${lang}/c/${category}` : `/${lang}/shop`}
          onClick={onDone}
          className={`${btnOutline} flex-1`}
        >
          {p.shop.reset}
        </Link>
      </div>
    </Form>
  );
}

export default function Shop({ loaderData }: Route.ComponentProps) {
  const { items, category, categories, q, sort, view } = loaderData;
  const { p, lang } = useT();
  const [params] = useSearchParams();
  const [sheet, setSheet] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const cat = categories.find((c) => c.key === category);
  const title = q ? p.shop.searchFor(q) : cat ? cat.name : p.shop.allTitle;

  useEffect(() => {
    if (!sheet) return;
    sheetRef.current?.querySelector<HTMLElement>("input, button, a")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSheet(false);
        opener.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sheet]);

  const withParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    return `?${next.toString()}`;
  };

  return (
    <>
      <section className="border-b border-sand bg-panel">
        <div className={`${container} py-6`}>
          <Breadcrumbs
            items={[
              { label: p.common.home, to: `/${lang}` },
              { label: p.shop.title, to: cat ? `/${lang}/shop` : undefined },
              ...(cat ? [{ label: cat.name }] : []),
            ]}
          />
          <h1 className="mt-2 text-3xl font-bold">{title}</h1>
          <div className="mt-2">
            <DemoBadge />
          </div>
        </div>
      </section>

      <div className={`${container} grid gap-8 py-8 lg:grid-cols-[16rem_1fr]`}>
        {sheet ? (
          <div
            className="fixed inset-0 z-40 bg-black/50 lg:hidden"
            aria-hidden
            onClick={() => setSheet(false)}
          />
        ) : null}
        <aside
          ref={sheetRef}
          role={sheet ? "dialog" : undefined}
          aria-modal={sheet ? true : undefined}
          aria-label={p.shop.filtersTitle}
          className={
            sheet
              ? "fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-soft lg:static lg:z-auto lg:max-h-none lg:rounded-none lg:bg-transparent lg:p-0 lg:shadow-none"
              : "hidden lg:block"
          }
        >
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-bold">{p.shop.filtersTitle}</h2>
            <button
              type="button"
              onClick={() => setSheet(false)}
              aria-label={p.common.close}
              className="grid size-9 place-items-center rounded-full hover:bg-panel lg:hidden"
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>
          <FilterForm category={category} categories={categories} onDone={() => setSheet(false)} />
        </aside>

        <div>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted" aria-live="polite">
              {p.shop.results(items.length)}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                ref={opener}
                type="button"
                onClick={() => setSheet(true)}
                className={`${btnOutline} !py-2 lg:hidden`}
              >
                <SlidersHorizontal className="size-4" aria-hidden />
                {p.shop.filters}
              </button>
              <Form method="get" className="flex items-center gap-2">
                {[...params.entries()]
                  .filter(([k]) => k !== "sort")
                  .map(([k, v], i) => (
                    <input key={`${k}-${i}`} type="hidden" name={k} value={v} />
                  ))}
                <label className="flex items-center gap-2 text-sm">
                  <span className="text-muted">{p.shop.sort}</span>
                  <select
                    name="sort"
                    defaultValue={sort}
                    onChange={(e) => e.currentTarget.form?.requestSubmit()}
                    className="rounded-input border border-sand bg-surface px-2 py-2 text-sm"
                  >
                    {SORTS.map((s) => (
                      <option key={s} value={s}>
                        {p.shop.sorts[s]}
                      </option>
                    ))}
                  </select>
                </label>
                <noscript>
                  <button type="submit">{p.shop.apply}</button>
                </noscript>
              </Form>
              <div className="flex overflow-hidden rounded-input border border-sand">
                <Link
                  to={withParam("view", "grid")}
                  aria-label={p.shop.gridView}
                  aria-current={view === "grid"}
                  className={`grid size-9 place-items-center ${view === "grid" ? "bg-cta text-cta-fg" : "hover:bg-panel"}`}
                >
                  <LayoutGrid className="size-4" aria-hidden />
                </Link>
                <Link
                  to={withParam("view", "list")}
                  aria-label={p.shop.listView}
                  aria-current={view === "list"}
                  className={`grid size-9 place-items-center ${view === "list" ? "bg-cta text-cta-fg" : "hover:bg-panel"}`}
                >
                  <List className="size-4" aria-hidden />
                </Link>
              </div>
            </div>
          </div>

          {items.length === 0 ? (
            <div className="rounded-card bg-panel p-10 text-center">
              <h2 className="text-xl font-bold">{p.shop.empty}</h2>
              <p className="mt-2 text-muted">
                {cat && !params.toString() ? p.shop.emptyCategory : p.shop.emptyBody}
              </p>
              <Link to={`/${lang}/shop`} className={`${btnPrimary} mt-5`}>
                {p.common.viewAll}
              </Link>
            </div>
          ) : (
            <ul
              className={
                view === "list" ? "grid gap-3" : "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
              }
            >
              {items.map((product) => (
                <li key={product.id}>
                  <ProductCard product={product} layout={view === "list" ? "row" : "card"} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
