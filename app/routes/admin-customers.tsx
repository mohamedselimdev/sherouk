import type { Route } from "./+types/admin-customers";
import { useT } from "~/i18n/context";
import { listCustomers } from "../../server/reporting/finance";
import { requireStaff } from "../../server/http/session";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { principal, scope } = await requireStaff(request, context, {
    lang: params.lang,
    permission: "customers:read",
  });
  return { customers: await listCustomers(scope.db, principal) };
}

export default function AdminCustomers({ loaderData }: Route.ComponentProps) {
  const { a } = useT();
  const m = a.modules;
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{m.customers}</h1>
      {loaderData.customers.length === 0 ? (
        <p className="rounded-card bg-panel p-6 text-center text-muted">{m.empty}</p>
      ) : (
        <ul className="grid gap-2 text-sm">
          {loaderData.customers.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-input border border-sand bg-surface p-3"
            >
              <span>
                <span className="block font-semibold">{c.name}</span>
                <span className="text-muted" dir="ltr">
                  {c.email}
                  {c.phone ? ` · ${c.phone}` : ""}
                </span>
              </span>
              <span className="text-muted">
                {m.ordersCount}: {c.orders} · {m.joined}: {c.createdAt.toISOString().slice(0, 10)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
