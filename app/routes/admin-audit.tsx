import { Form } from "react-router";
import type { Route } from "./+types/admin-audit";
import { useT } from "~/i18n/context";
import { inputCls } from "~/components/form";
import { btnOutline } from "~/components/ui";
import { listAudit } from "../../server/reporting/finance";
import { requireStaff } from "../../server/http/session";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { principal, scope } = await requireStaff(request, context, {
    lang: params.lang,
    permission: "audit:read",
  });
  const prefix = new URL(request.url).searchParams.get("action") ?? "";
  return { rows: await listAudit(scope.db, principal, { actionPrefix: prefix, limit: 200 }), prefix };
}

export default function AdminAudit({ loaderData }: Route.ComponentProps) {
  const { a } = useT();
  const m = a.modules;
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{m.audit}</h1>
      <Form method="get" className="flex max-w-lg gap-2">
        <label className="flex-1 text-sm">
          <span className="sr-only">{m.auditFilter}</span>
          <input
            name="action"
            defaultValue={loaderData.prefix}
            placeholder={m.auditFilter}
            dir="ltr"
            className={`${inputCls} !mt-0`}
          />
        </label>
        <button type="submit" className={btnOutline}>
          {m.action}
        </button>
      </Form>
      {loaderData.rows.length === 0 ? (
        <p className="rounded-card bg-panel p-6 text-center text-muted">{m.empty}</p>
      ) : (
        <ul className="grid gap-2 text-sm">
          {loaderData.rows.map((r) => (
            <li key={r.id} className="rounded-input border border-sand bg-surface p-3">
              <p className="flex flex-wrap justify-between gap-2">
                <span className="font-mono font-semibold" dir="ltr">
                  {r.action}
                </span>
                <time className="text-muted" dateTime={r.at.toISOString()}>
                  {r.at.toISOString().slice(0, 19).replace("T", " ")} UTC
                </time>
              </p>
              <p className="text-muted">
                {m.who}: <span dir="ltr">{r.actor ?? "—"}</span>
                {r.entityType ? ` · ${r.entityType}` : ""}
                {r.detail ? ` · ${r.detail}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
