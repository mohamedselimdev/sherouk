import type { Locale } from "~/i18n/config";
import { HREFLANG } from "~/i18n/config";

type Meta = Record<string, unknown>;

export type PageSeo = {
  /** Origin from configuration, no trailing slash. */
  siteUrl: string;
  lang: Locale;
  /** Path (starting with "/") of the same page in each language, without the origin. */
  paths: Record<Locale, string>;
  title: string;
  description?: string;
  image?: string | null;
  /** Only the production environment is indexable; staging and local always send noindex. */
  index: boolean;
  jsonLd?: Record<string, unknown>[];
};

/** Title, description, robots, canonical, hreflang alternates, Open Graph/Twitter tags and optional JSON-LD. */
export function pageMeta(s: PageSeo): Meta[] {
  const abs = (p: string) => `${s.siteUrl}${p}`;
  const canonical = abs(s.paths[s.lang]);
  const meta: Meta[] = [
    { title: s.title },
    { name: "robots", content: s.index ? "index,follow" : "noindex,nofollow" },
    { tagName: "link", rel: "canonical", href: canonical },
    { tagName: "link", rel: "alternate", hrefLang: HREFLANG.ar, href: abs(s.paths.ar) },
    { tagName: "link", rel: "alternate", hrefLang: HREFLANG.en, href: abs(s.paths.en) },
    { tagName: "link", rel: "alternate", hrefLang: "x-default", href: abs(s.paths.ar) },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: "SHROUK | شروق" },
    { property: "og:title", content: s.title },
    { property: "og:url", content: canonical },
    { property: "og:locale", content: HREFLANG[s.lang].replace("-", "_") },
    { name: "twitter:card", content: s.image ? "summary_large_image" : "summary" },
    { name: "twitter:title", content: s.title },
  ];
  if (s.description) {
    meta.push(
      { name: "description", content: s.description },
      { property: "og:description", content: s.description },
      { name: "twitter:description", content: s.description },
    );
  }
  if (s.image) {
    const url = s.image.startsWith("http") ? s.image : abs(s.image);
    meta.push({ property: "og:image", content: url }, { name: "twitter:image", content: url });
  }
  for (const ld of s.jsonLd ?? []) meta.push({ "script:ld+json": ld });
  return meta;
}

/** Product + Offer markup from the real catalog price and stock only. No ratings: there are no real reviews yet. */
export function productJsonLd(input: {
  siteUrl: string;
  url: string;
  name: string;
  description?: string;
  image?: string | null;
  sku: string;
  pricePiasters: number;
  inStock: boolean;
}): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: input.name,
    ...(input.description ? { description: input.description } : {}),
    ...(input.image
      ? { image: input.image.startsWith("http") ? input.image : `${input.siteUrl}${input.image}` }
      : {}),
    sku: input.sku,
    brand: { "@type": "Brand", name: "SHROUK" },
    offers: {
      "@type": "Offer",
      url: input.url,
      priceCurrency: "EGP",
      price: (input.pricePiasters / 100).toFixed(2),
      availability: input.inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    },
  };
}

export function breadcrumbJsonLd(items: { name: string; url: string }[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: it.url,
    })),
  };
}

/** Configured origin without a trailing slash. */
export function siteOrigin(siteUrl: string): string {
  return siteUrl.endsWith("/") ? siteUrl.slice(0, -1) : siteUrl;
}
