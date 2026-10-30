import { Link } from "react-router";
import type { Route } from "./+types/admin-finance";
import { useT } from "~/i18n/context";
import { formatEGP } from "~/lib/format";
import { btnPrimary } from "~/components/ui";
import { financeSummary } from "../../server/reporting/finance";
import { requireStaff } from "../../server/http/session";

const RANGES = [7, 30, 90] as const;

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { principal, scope } = await requireStaff(request, context, {
    lang: params.lang,
    permission: "finance:read",
  });
  const asked = Number(new URL(request.url).searchParams.get("days"));
  const days = (RANGES as readonly number[]).includes(asked) ? asked : 30;
  return { summary: await financeSummary(scope.db, principal, days), days };
}

export default function AdminFinance({ loaderData }: Route.ComponentProps) {
  const { a, lang } = useT();
  const m = a.modules;
  const { summary: s, days } = loaderData;
  const card = "rounded-card border border-sand bg-surface p-4";
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{m.finance}</h1>
        <div className="flex flex-wrap items-center gap-2">
          {RANGES.map((r) => (
            <Link
              key={r}
              to={`?days=${r}`}
              aria-current={r === days}
              className={`rounded-input px-3 py-2 text-sm ${r === days ? "bg-cta text-cta-fg" : "bg-panel hover:bg-sand"}`}
            >
              {a.dashboard.last(r)}
            </Link>
          ))}
          <a href={`/${lang}/admin/finance.csv?days=${days}`} className={btnPrimary}>
            {m.exportCsv}
          </a>
        </div>
      </div>
      <p className="text-xs text-muted">{m.financeNote}</p>
      <ul className="grid gap-4 sm:grid-cols-3">
        <li className={card}>
          <p className="text-sm text-muted">{m.collected}</p>
          <p className="text-2xl font-bold">{formatEGP(s.collectedPiasters, lang)}</p>
        </li>
        <li className={card}>
          <p className="text-sm text-muted">{m.refunded}</p>
          <p className="text-2xl font-bold">{formatEGP(s.refundedPiasters, lang)}</p>
        </li>
        <li className={card}>
          <p className="text-sm text-muted">{m.net}</p>
          <p className="text-2xl font-bold">{formatEGP(s.netPiasters, lang)}</p>
        </li>
      </ul>
      <p className={`${card} text-sm`}>
        {m.pendingCod}: <strong>{formatEGP(s.pendingCodPiasters, lang)}</strong>
      </p>
      <section aria-labelledby="bm-h">
        <h2 id="bm-h" className="mb-2 text-lg font-bold">
          {m.byMethod}
        </h2>
        {s.byMethod.length === 0 ? (
          <p className="text-sm text-muted">{m.empty}</p>
        ) : (
          <ul className="grid gap-2 text-sm">
            {s.byMethod.map((x) => (
              <li key={x.method} className={`${card} flex justify-between`}>
                <span>{m.methods[x.method as keyof typeof m.methods]}</span>
                <span>
                  {x.orders} · {formatEGP(x.collectedPiasters, lang)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
