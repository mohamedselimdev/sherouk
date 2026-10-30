import { createRequestHandler, RouterContextProvider } from "react-router";
import { RequestScope, scopeContext } from "../server/context";
import { createDb } from "../server/db";
import { parseEnv } from "../server/env";
import { expireStaleOrders } from "../server/orders/service";
import { buildPaymob } from "../server/payments";
import { reconcilePendingPayments } from "../server/payments/service";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

function withSecurityHeaders(response: Response, request: Request, secure: boolean): Response {
  const res = new Response(response.body, response);
  const h = res.headers;
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "strict-origin-when-cross-origin");
  h.set("X-Frame-Options", "DENY");
  h.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  h.set("Cross-Origin-Opener-Policy", "same-origin");
  if (secure) h.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  const path = new URL(request.url).pathname;
  if (/^\/(ar|en)\/(admin|account)(\/|$)/.test(path)) {
    h.set("Cache-Control", "no-store");
    h.set("X-Robots-Tag", "noindex, nofollow");
  }
  return res;
}

export default {
  async fetch(request, rawEnv, ctx) {
    let env;
    try {
      env = parseEnv(rawEnv as unknown as Record<string, unknown>);
    } catch (error) {
      console.error(JSON.stringify({ level: "error", msg: (error as Error).message }));
      return new Response("Service misconfigured", { status: 500 });
    }
    const correlationId = request.headers.get("cf-ray") ?? crypto.randomUUID();
    const scope = new RequestScope(env, correlationId);
    const context = new RouterContextProvider();
    context.set(scopeContext, scope);
    try {
      const response = await requestHandler(request, context);
      const finished = withSecurityHeaders(response, request, scope.secureCookies);
      finished.headers.set("X-Request-Id", correlationId);
      ctx.waitUntil(scope.close());
      return finished;
    } catch (error) {
      ctx.waitUntil(scope.close());
      console.error(
        JSON.stringify({
          level: "error",
          correlationId,
          msg: (error as Error).message,
          name: (error as Error).name,
        }),
      );
      return new Response("Internal error", { status: 500, headers: { "X-Request-Id": correlationId } });
    }
  },
  /** Cron: release stock held by unpaid orders whose payment window has passed. */
  async scheduled(_controller, rawEnv, ctx) {
    const env = parseEnv(rawEnv as unknown as Record<string, unknown>);
    const handle = createDb(env.HYPERDRIVE.connectionString, 2);
    const paymob = buildPaymob(env);
    ctx.waitUntil(
      (async () => {
        try {
          const expired = await expireStaleOrders(handle.db);
          console.log(JSON.stringify({ level: "info", job: "expire-orders", ...expired }));
          // Recover payments whose webhook never arrived (only when the provider supports inquiry and is configured).
          if (paymob && env.PAYMOB_API_KEY) {
            const rec = await reconcilePendingPayments(handle.db, paymob);
            console.log(JSON.stringify({ level: "info", job: "reconcile-payments", ...rec }));
          }
        } catch (e) {
          console.error(JSON.stringify({ level: "error", job: "scheduled", msg: (e as Error).message }));
        } finally {
          await handle.close();
        }
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
