import { Link, useSearchParams } from "react-router";
import type { Route } from "./+types/admin-orders";
import { useT } from "~/i18n/context";
import { formatEGP } from "~/lib/format";
import { listOrders } from "../../server/orders/service";
import type { OrderStatus } from "../../server/orders/state";
import { requireStaff } from "../../server/http/session";

const STATUSES: OrderStatus[] = ["pending_payment", "confirmed", "processing", "completed", "cancelled"];

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { principal, scope } = await requireStaff(request, context, {
    lang: params.lang,
    permission: "orders:read",
    anyScope: true,
  });
  const s = new URL(request.url).searchParams.get("status");
  const status = STATUSES.find((x) => x === s);
  return { orders: await listOrders(scope.db, principal, { status }) };
}

export default function AdminOrders({ loaderData }: Route.ComponentProps) {
  const { a, p, lang } = useT();
  const [params] = useSearchParams();
  const current = params.get("status");
  const chip = (active: boolean) =>
    `rounded-input px-3 py-2 text-sm ${active ? "bg-cta text-cta-fg" : "bg-panel hover:bg-sand"}`;
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{a.orders.title}</h1>
      <nav aria-label={a.orders.status} className="flex flex-wrap gap-2">
        <Link to="?" className={chip(!current)}>
          {a.orders.all}
        </Link>
        {STATUSES.map((s) => (
          <Link key={s} to={`?status=${s}`} className={chip(current === s)}>
            {p.order.status[s]}
          </Link>
        ))}
      </nav>
      {loaderData.orders.length === 0 ? (
        <p className="rounded-card bg-panel p-8 text-center text-muted">{a.orders.none}</p>
      ) : (
        <ul className="grid gap-3">
          {loaderData.orders.map((o) => (
            <li key={o.id} className="rounded-card border border-sand bg-surface p-4 text-sm">
              <Link
                to={`/${lang}/admin/orders/${o.ref}`}
                className="flex flex-wrap items-center justify-between gap-3"
              >
                <span>
                  <span className="block font-mono font-semibold" dir="ltr">
                    {o.ref}
                  </span>
                  <span className="text-muted">{o.contactName}</span>
                </span>
                <span className="text-muted">
                  {p.order.status[o.status]} · {p.order.payment[o.paymentStatus]} ·{" "}
                  {p.order.fulfillment[o.fulfillmentStatus]}
                  {o.needsRefund || o.exception ? (
                    <strong className="ms-2 text-red-700 dark:text-red-300">{a.orders.needsRefund}</strong>
                  ) : null}
                </span>
                <span className="font-bold">{formatEGP(o.totalPiasters, lang)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
