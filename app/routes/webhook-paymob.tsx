import { ZodError } from "zod";
import type { Route } from "./+types/webhook-paymob";
import { normalizePaymobTransaction, verifyPaymobHmac } from "../../server/payments/paymob";
import { handleProviderEvent } from "../../server/payments/service";
import { getScope } from "../../server/http/session";

const MAX_BODY = 64 * 1024;

export function loader() {
  return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
}

/**
 * Paymob "processed callback". Nothing in the request is trusted until the HMAC over the transaction object verifies
 * with the merchant HMAC secret (timing-safe). Money moves only through `handleProviderEvent`, which checks the
 * expected amount, currency and order and is idempotent. The browser redirect is never an input here.
 */
export async function action({ request, context }: Route.ActionArgs) {
  const scope = getScope(context);
  const secret = scope.env.PAYMOB_HMAC_SECRET;
  if (!secret) return new Response("Payments not configured", { status: 503 });
  const raw = await request.text();
  if (raw.length > MAX_BODY) return new Response("Payload too large", { status: 413 });

  let body: { type?: string; obj?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const hmac = new URL(request.url).searchParams.get("hmac");
  if (!(await verifyPaymobHmac(body.obj, hmac, secret))) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "paymob_webhook_rejected",
        reason: "bad_hmac",
        correlationId: scope.correlationId,
      }),
    );
    return new Response("Invalid signature", { status: 401 });
  }
  if (body.type !== "TRANSACTION") return Response.json({ ok: true, ignored: body.type ?? null });

  try {
    const ev = normalizePaymobTransaction(body.obj);
    const result = await handleProviderEvent(scope.db, ev);
    console.log(
      JSON.stringify({
        level: "info",
        event: "paymob_webhook",
        outcome: result.outcome,
        transaction: ev.transactionId,
        order: result.orderRef,
        correlationId: scope.correlationId,
      }),
    );
    return Response.json({ ok: true, outcome: result.outcome });
  } catch (e) {
    if (e instanceof ZodError) return new Response("Unexpected payload shape", { status: 422 });
    throw e;
  }
}
