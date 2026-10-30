import type { Route } from "./+types/robots";
import { siteOrigin } from "~/lib/seo";
import { getScope } from "../../server/http/session";

export function loader({ context }: Route.LoaderArgs) {
  const env = getScope(context).env;
  const site = siteOrigin(env.SITE_URL);
  const body =
    env.APP_ENV === "production"
      ? [
          "User-agent: *",
          "Disallow: /ar/admin",
          "Disallow: /en/admin",
          "Disallow: /ar/account",
          "Disallow: /en/account",
          "Disallow: /ar/cart",
          "Disallow: /en/cart",
          "Disallow: /ar/checkout",
          "Disallow: /en/checkout",
          "Disallow: /ar/order",
          "Disallow: /en/order",
          "Disallow: /ar/api",
          "Disallow: /en/api",
          "Disallow: /webhooks",
          "Allow: /media/",
          `Sitemap: ${site}/sitemap.xml`,
        ]
      : ["User-agent: *", "Disallow: /"]; // staging and local are never indexed
  return new Response(body.join("\n") + "\n", {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
