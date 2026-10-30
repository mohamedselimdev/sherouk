import type { Route } from "./+types/sitemap";
import { listStoreCategories, listStoreProducts } from "../../server/catalog/store";
import { siteOrigin } from "~/lib/seo";
import { getScope } from "../../server/http/session";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Localised sitemap with hreflang alternates for the indexable catalog pages. Empty outside production. */
export async function loader({ context }: Route.LoaderArgs) {
  const scope = getScope(context);
  const site = siteOrigin(scope.env.SITE_URL);
  const headers = {
    "Content-Type": "application/xml; charset=utf-8",
    "Cache-Control": "public, max-age=3600",
  };
  if (scope.env.APP_ENV !== "production") {
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"/>',
      { headers },
    );
  }
  const [products, cats] = await Promise.all([
    listStoreProducts(scope.catalogDb),
    listStoreCategories(scope.catalogDb, "en"),
  ]);
  type Entry = { ar: string; en: string };
  const entries: Entry[] = [
    { ar: "/ar", en: "/en" },
    { ar: "/ar/shop", en: "/en/shop" },
    ...cats.map((c) => ({ ar: `/ar/c/${c.key}`, en: `/en/c/${c.key}` })),
    ...products.map((p) => ({ ar: `/ar/p/${p.slug.ar}`, en: `/en/p/${p.slug.en}` })),
  ];
  const urls = entries
    .flatMap((e) => [e.ar, e.en].map((self) => ({ self, e })))
    .map(
      ({ self, e }) =>
        `<url><loc>${esc(site + self)}</loc><xhtml:link rel="alternate" hreflang="ar-EG" href="${esc(site + e.ar)}"/><xhtml:link rel="alternate" hreflang="en-EG" href="${esc(site + e.en)}"/></url>`,
    )
    .join("");
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls}</urlset>`,
    { headers },
  );
}
