import { data } from "react-router";
import type { Route } from "./+types/media";
import { getScope } from "../../server/http/session";

/** Public product images only: random keys under `products/`. Anything else in the bucket is never served. */
const KEY = /^products\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;
const TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

export async function loader({ params, context }: Route.LoaderArgs) {
  const key = params["*"] ?? "";
  if (!KEY.test(key)) throw data(null, { status: 404 });
  const object = await getScope(context).env.MEDIA.get(key);
  if (!object) throw data(null, { status: 404 });
  return new Response(object.body, {
    headers: {
      "Content-Type": TYPES[key.split(".").pop()!] ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: object.httpEtag,
    },
  });
}
