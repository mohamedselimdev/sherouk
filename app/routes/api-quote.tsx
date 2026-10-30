import { z } from "zod";
import type { Route } from "./+types/api-quote";
import { InvalidOrder, quoteOrder } from "../../server/orders/service";
import { GOVERNORATE_KEYS } from "../../server/fulfillment/governorates";
import { hit, TooManyRequestsError } from "../../server/security/throttle";
import { assertSameOrigin, clientIp, getScope } from "../../server/http/session";

const body = z.object({
  lines: z
    .array(z.object({ variantId: z.uuid(), quantity: z.number().int().min(1).max(10) }))
    .min(1)
    .max(20),
  governorate: z.enum(GOVERNORATE_KEYS as [string, ...string[]]).nullish(),
  couponCode: z.string().trim().max(40).nullish(),
  deliveryMethod: z.enum(["delivery", "pickup"]).default("delivery"),
});

/** Read-only pricing for the cart and checkout screens. Never changes stock or coupon counters. */
export async function action({ request, context }: Route.ActionArgs) {
  assertSameOrigin(request);
  const scope = getScope(context);
  try {
    await hit(scope.db, `quote:ip:${clientIp(request)}`, 120, 60);
    const parsed = body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ ok: false, error: "invalid" }, { status: 400 });
    const quote = await quoteOrder(scope.db, parsed.data);
    return Response.json({ ok: true, quote }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof TooManyRequestsError)
      return Response.json({ ok: false, error: "tooMany" }, { status: 429 });
    if (e instanceof InvalidOrder) {
      const error = e.code === "coupon" ? e.message : e.code === "unavailable" ? "unavailable" : e.code;
      return Response.json({ ok: false, error }, { status: 422 });
    }
    throw e;
  }
}
