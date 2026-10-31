import { Form, Link, useActionData, useOutletContext } from "react-router";
import type { Route } from "./+types/admin-support";
import type { AdminOutletContext } from "~/layouts/admin";
import { useT } from "~/i18n/context";
import { FormError } from "~/components/form";
import { btnOutline } from "~/components/ui";
import { ForbiddenError } from "../../server/auth/rbac";
import { NotFoundError } from "../../server/catalog/admin";
import { requireStaff, requireStaffAction } from "../../server/http/session";
import { listTickets, setTicketStatus } from "../../server/support/tickets";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { principal, scope } = await requireStaff(request, context, {
    lang: params.lang,
    permission: "support:manage",
  });
  const filter = new URL(request.url).searchParams.get("status");
  const status = filter === "closed" || filter === "all" ? filter : "open";
  return { status, tickets: await listTickets(scope.db, principal, status) };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const { auth, form } = await requireStaffAction(request, context, { lang: params.lang });
  try {
    await setTicketStatus(
      auth.scope.db,
      auth.principal,
      form.get("id")?.toString() ?? "",
      form.get("status") === "open" ? "open" : "closed",
    );
    return { ok: true as const };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "forbidden" as const };
    if (e instanceof NotFoundError) return { error: "invalid" as const };
    throw e;
  }
}

export default function AdminSupport({ loaderData }: Route.ComponentProps) {
  const { a, lang } = useT();
  const m = a.modules;
  const result = useActionData<typeof action>();
  const { csrf } = useOutletContext<AdminOutletContext>();
  const tab = (key: "open" | "closed" | "all", label: string) => (
    <Link
      to={`/${lang}/admin/support?status=${key}`}
      aria-current={loaderData.status === key}
      className={`rounded-input px-4 py-2 text-sm font-medium ${loaderData.status === key ? "bg-cta text-cta-fg" : "bg-panel hover:bg-sand"}`}
    >
      {label}
    </Link>
  );
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{m.support}</h1>
      <FormError>{result && "error" in result && result.error ? m[result.error] : null}</FormError>
      <nav aria-label={m.support} className="flex flex-wrap gap-2">
        {tab("open", m.ticketsOpen)}
        {tab("closed", m.ticketsClosed)}
        {tab("all", m.ticketsAll)}
      </nav>
      {loaderData.tickets.length === 0 ? (
        <p className="rounded-card bg-panel p-6 text-center text-muted">{m.empty}</p>
      ) : (
        <ul className="grid gap-3 text-sm">
          {loaderData.tickets.map((t) => (
            <li key={t.id} className="grid gap-2 rounded-card border border-sand bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold" dir="ltr">
                  {t.ref}
                </span>
                <span className="text-muted">{t.createdAt.toISOString().slice(0, 16).replace("T", " ")}</span>
              </div>
              <p>
                <span className="font-medium">{t.name}</span>
                <span className="text-muted" dir="ltr">
                  {t.phone ? ` · ${t.phone}` : ""}
                  {t.email ? ` · ${t.email}` : ""}
                  {t.orderRef ? ` · ${t.orderRef}` : ""}
                </span>
              </p>
              <p className="whitespace-pre-line">{t.message}</p>
              <Form method="post">
                <input type="hidden" name="_csrf" value={csrf} />
                <input type="hidden" name="id" value={t.id} />
                <input type="hidden" name="status" value={t.status === "open" ? "closed" : "open"} />
                <button type="submit" className={btnOutline}>
                  {t.status === "open" ? m.closeTicket : m.reopenTicket}
                </button>
              </Form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
