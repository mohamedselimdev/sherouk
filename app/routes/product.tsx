import { useState } from "react";
import { data, useNavigate } from "react-router";
import { ChevronDown, Maximize2, ScanFace, ShieldCheck, Sun, Weight } from "lucide-react";
import type { Route } from "./+types/product";
import { colorHex, colorName } from "~/demo/data";
import { getStoreProduct, listStoreCategories, listStoreProducts } from "../../server/catalog/store";
import { getScope } from "../../server/http/session";
import { breadcrumbJsonLd, pageMeta, productJsonLd, siteOrigin } from "~/lib/seo";
import { DEFAULT_LOCALE, isLocale } from "~/i18n/config";
import { useT } from "~/i18n/context";
import { formatEGP } from "~/lib/format";
import { useCart } from "~/lib/cart";
import {
  AddToCartButton,
  Breadcrumbs,
  btnOutline,
  btnPrimary,
  container,
  DemoBadge,
  discountPct,
  Price,
  ProductCard,
  SectionHeading,
  TrustStrip,
  WishlistButton,
} from "~/components/ui";

export async function loader({ params, context }: Route.LoaderArgs) {
  const lang = isLocale(params.lang) ? params.lang : DEFAULT_LOCALE;
  const scope = getScope(context);
  const db = scope.catalogDb;
  const product = await getStoreProduct(db, lang, params.slug);
  if (!product) throw data(null, { status: 404 });
  const [categories, all] = await Promise.all([listStoreCategories(db, lang), listStoreProducts(db)]);
  return {
    siteUrl: siteOrigin(scope.env.SITE_URL),
    index: scope.env.APP_ENV === "production",
    product,
    category: categories.find((c) => c.key === product.category) ?? null,
    related: all.filter((x) => x.id !== product.id).slice(0, 4),
  };
}

export function meta({ loaderData: d, params }: Route.MetaArgs) {
  const lang = isLocale(params.lang) ? params.lang : DEFAULT_LOCALE;
  if (!d) return [{ title: "SHROUK" }, { name: "robots", content: "noindex" }];
  const { product, siteUrl, category } = d;
  const paths = { ar: `/ar/p/${product.slug.ar}`, en: `/en/p/${product.slug.en}` };
  const description = product.description[lang] || product.sub[lang] || undefined;
  return pageMeta({
    siteUrl,
    index: d.index,
    lang,
    paths,
    title: `${product.name[lang]} | SHROUK`,
    description,
    image: product.image,
    jsonLd: [
      productJsonLd({
        siteUrl,
        url: siteUrl + paths[lang],
        name: product.name[lang],
        description,
        image: product.image,
        sku: product.colors[0]?.sku ?? product.id,
        pricePiasters: product.price,
        inStock: product.inStock,
      }),
      breadcrumbJsonLd([
        { name: lang === "ar" ? "الرئيسية" : "Home", url: `${siteUrl}/${lang}` },
        ...(category ? [{ name: category.name, url: `${siteUrl}/${lang}/c/${category.key}` }] : []),
        { name: product.name[lang], url: siteUrl + paths[lang] },
      ]),
    ],
  });
}

const FEATURE_ICONS = [Sun, ScanFace, Weight, ShieldCheck];

export default function Product({ loaderData }: Route.ComponentProps) {
  const { product, category: cat, related } = loaderData;
  const { p, lang } = useT();
  const { add } = useCart();
  const navigate = useNavigate();
  const [color, setColor] = useState<string>(product.colors[0]?.colorKey ?? "");
  const [shot, setShot] = useState(0);
  const [tab, setTab] = useState<"description" | "details" | "reviews">("description");
  const [open, setOpen] = useState<string | null>(null);
  const chosen = product.colors.find((c) => c.colorKey === color) ?? product.colors[0]!;
  const pct = discountPct(product);
  // Real photos when there are several; with a single image (demo art) show crops of it until photography exists.
  const FALLBACK = "/assets/brand/app-icon-512.png";
  const shots =
    product.images.length > 1
      ? product.images.map((src) => ({ src, pos: "center", scale: 1.05 }))
      : [
          { src: product.image ?? FALLBACK, pos: "center", scale: 1.05 },
          ...(product.image
            ? [
                { src: product.image, pos: "30% 50%", scale: 1.8 },
                { src: product.image, pos: "70% 50%", scale: 1.8 },
                { src: product.image, pos: "50% 40%", scale: 1.3 },
              ]
            : []),
        ];

  return (
    <>
      <div className={`${container} pt-5`}>
        <Breadcrumbs
          items={[
            { label: p.common.home, to: `/${lang}` },
            ...(cat ? [{ label: cat.name, to: `/${lang}/c/${cat.key}` }] : []),
            { label: product.name[lang] },
          ]}
        />
      </div>

      <div
        className={`${container} grid grid-cols-[minmax(0,1fr)] gap-8 py-6 lg:grid-cols-[1fr_26rem] xl:grid-cols-[1fr_30rem] rtl:lg:grid-cols-[26rem_1fr] rtl:xl:grid-cols-[30rem_1fr]`}
      >
        <section
          aria-label={p.product.gallery(shot + 1, shots.length)}
          className="grid gap-3 sm:grid-cols-[5rem_1fr] rtl:lg:order-2"
        >
          <ul className="order-2 flex gap-2 sm:order-1 sm:flex-col">
            {shots.map((s, i) => (
              <li key={i} className="flex-1 sm:flex-none">
                <button
                  type="button"
                  onClick={() => setShot(i)}
                  aria-label={p.product.gallery(i + 1, shots.length)}
                  aria-current={shot === i}
                  className={`block w-full overflow-hidden rounded-input border-2 ${shot === i ? "border-cta" : "border-transparent"}`}
                >
                  <span className="block aspect-[800/490] overflow-hidden bg-panel">
                    <img
                      src={s.src}
                      alt=""
                      loading="lazy"
                      className="size-full object-cover"
                      style={{ objectPosition: s.pos, transform: `scale(${s.scale})` }}
                    />
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="relative order-1 overflow-hidden rounded-card bg-panel sm:order-2">
            <div className="aspect-[800/490] overflow-hidden">
              <img
                src={shots[shot]!.src}
                alt={product.name[lang]}
                fetchPriority="high"
                width={800}
                height={490}
                className="size-full object-cover transition-transform duration-300"
                style={{ objectPosition: shots[shot]!.pos, transform: `scale(${shots[shot]!.scale})` }}
              />
            </div>
            <p className="absolute bottom-2 start-3 rounded bg-surface/80 px-2 py-0.5 text-xs text-muted">
              {p.product.imageNote}
            </p>
            <span dir="ltr" className="absolute end-3 top-3 rounded bg-surface/90 px-2 py-1 text-xs">
              {shot + 1} / {shots.length}
            </span>
            <Maximize2
              className="pointer-events-none absolute bottom-3 end-3 size-5 text-muted"
              aria-hidden
            />
          </div>
        </section>

        <section className="rtl:lg:order-1">
          {product.featured ? (
            <span className="rounded bg-cta px-2 py-1 text-xs font-medium text-cta-fg">
              {p.common.bestSeller}
            </span>
          ) : null}
          <h1 className="mt-2 text-2xl font-bold sm:text-3xl">{product.name[lang]}</h1>
          <p className="mt-2 text-muted">{product.sub[lang]}</p>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-lg">
            <Price product={product} />
            {pct ? (
              <span className="rounded bg-cta px-2 py-0.5 text-xs font-medium text-cta-fg">
                {pct}% {p.common.discount}
              </span>
            ) : null}
          </div>

          <fieldset className="mt-6">
            <legend className="mb-2 font-semibold">
              {p.product.colorLabel}: <span className="font-normal text-muted">{colorName(color, lang)}</span>
            </legend>
            <div className="flex gap-3">
              {product.colors.map(({ colorKey: c }) => (
                <label key={c} className="cursor-pointer">
                  <input
                    type="radio"
                    name="color"
                    value={c}
                    checked={color === c}
                    onChange={() => setColor(c)}
                    className="peer sr-only"
                  />
                  <span
                    className="block size-9 rounded-full border border-black/20 peer-checked:ring-2 peer-checked:ring-cta peer-checked:ring-offset-2 peer-checked:ring-offset-bg peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-cta"
                    style={{ background: colorHex(c) }}
                  />
                  <span className="sr-only">{colorName(c, lang)}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="mt-6">
            <p className="mb-2 font-semibold">{p.product.size}</p>
            <p className="inline-block rounded-input border border-sand px-4 py-2 text-sm">
              {p.product.oneSize}
            </p>
            <p className="mt-1 text-xs text-muted">{p.product.sizeHint}</p>
          </div>

          <div className="mt-6 grid gap-3">
            <AddToCartButton product={product} colorKey={color} className={`${btnPrimary} w-full !py-4`} />
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  add(product, chosen);
                  navigate(`/${lang}/cart`);
                }}
                className={`${btnOutline} flex-1 !py-4`}
              >
                {p.product.buyNow}
              </button>
              <WishlistButton productId={product.id} className="!size-14 !rounded-input border border-cta" />
            </div>
          </div>
          <TrustStrip className="mt-6 !grid-cols-2" />
          <div className="mt-3">
            <DemoBadge />
          </div>
        </section>
      </div>

      <div className={`${container} space-y-10 pb-28 lg:pb-10`}>
        <section className="hidden md:block">
          <div role="tablist" className="flex gap-1 rounded-card bg-panel p-1">
            {(["description", "details", "reviews"] as const).map((k) => (
              <button
                key={k}
                role="tab"
                id={`tab-${k}`}
                aria-selected={tab === k}
                aria-controls={`panel-${k}`}
                onClick={() => setTab(k)}
                className={`flex-1 rounded-input px-4 py-3 text-sm font-semibold ${tab === k ? "bg-surface text-cta shadow-soft" : "text-muted hover:text-fg"}`}
              >
                {p.product[k]}
              </button>
            ))}
          </div>
          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="py-6">
            <TabBody tab={tab} />
          </div>
        </section>

        <section className="md:hidden">
          {(["description", "details", "reviews", "ship"] as const).map((k) => {
            const label = k === "ship" ? p.product.shipReturn : p.product[k];
            const isOpen = open === k;
            return (
              <div key={k} className="border-b border-sand">
                <h2>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={`acc-${k}`}
                    onClick={() => setOpen(isOpen ? null : k)}
                    className="flex w-full items-center justify-between py-4 font-semibold"
                  >
                    {label}
                    <ChevronDown className={`size-5 transition ${isOpen ? "rotate-180" : ""}`} aria-hidden />
                  </button>
                </h2>
                <div id={`acc-${k}`} hidden={!isOpen} className="pb-4">
                  {k === "ship" ? (
                    <p className="text-sm text-muted">{p.product.shipReturnBody}</p>
                  ) : (
                    <TabBody tab={k} />
                  )}
                </div>
              </div>
            );
          })}
        </section>

        <section>
          <SectionHeading title={p.product.related} href={`/${lang}/shop`} linkLabel={p.common.viewAll} />
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {related.map((r) => (
              <li key={r.id}>
                <ProductCard product={r} />
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-sand bg-surface p-3 shadow-soft md:hidden">
        <div className="mx-auto flex max-w-md items-center gap-3">
          <p className="leading-tight">
            <span className="block font-bold">{formatEGP(product.price, lang)}</span>
            {product.oldPrice ? (
              <span className="block text-xs text-muted line-through">
                {formatEGP(product.oldPrice, lang)}
              </span>
            ) : null}
          </p>
          <AddToCartButton product={product} colorKey={color} className={`${btnPrimary} flex-1`} />
        </div>
      </div>
    </>
  );

  function TabBody({ tab }: { tab: "description" | "details" | "reviews" }) {
    if (tab === "reviews") return <p className="text-muted">{p.product.reviewsNone}</p>;
    if (tab === "details")
      return (
        <ul className="grid gap-2 text-sm sm:grid-cols-2">
          <li>SKU: {chosen.sku}</li>
          <li>
            {p.shop.frameShape}:{" "}
            {product.shape ? (p.shop.shapes as Record<string, string>)[product.shape] : "—"}
          </li>
          <li>
            {p.product.colorLabel}: {product.colors.map((c) => colorName(c.colorKey, lang)).join(" / ")}
          </li>
        </ul>
      );
    return (
      <div className="grid gap-6 md:grid-cols-2">
        <p className="text-muted">{product.description[lang] || p.product.descBody}</p>
        <ul className="grid gap-3 text-sm">
          {p.product.spec.map((s, i) => {
            const Icon = FEATURE_ICONS[i] ?? ShieldCheck;
            return (
              <li key={s} className="flex items-center gap-3">
                <Icon className="size-5 shrink-0 text-brown" aria-hidden />
                {s}
              </li>
            );
          })}
        </ul>
      </div>
    );
  }
}
