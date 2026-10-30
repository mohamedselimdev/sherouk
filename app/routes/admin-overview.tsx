import { Link } from "react-router";
import { Boxes, Percent, ShoppingCart, UserPlus, Wallet } from "lucide-react";
import type { Route } from "./+types/admin-overview";
import { useT } from "~/i18n/context";
import { formatEGP } from "~/lib/format";
import { overview } from "../../server/reporting/overview";
import { requireStaff } from "../../server/http/session";

export function meta({ params }: Route.MetaArgs) {
  return [
    { title: `${params.lang === "ar" ? "نظرة عامة" : "Overview"} | SHROUK` },
    { name: "robots", content: "noindex,nofollow" },
  ];
}

const RANGES = [7, 30, 90] as const;

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { principal, scope } = await requireStaff(request, context, { lang: params.lang });
  const asked = Number(new URL(request.url).searchParams.get("days"));
  const days = (RANGES as readonly number[]).includes(asked) ? asked : 30;
  return {
    data: await overview(scope.db, principal, { days, locale: params.lang === "en" ? "en" : "ar" }),
    days,
  };
}

function RevenueChart({
  series,
  label,
}: {
  series: { day: string; revenuePiasters: number }[];
  label: string;
}) {
  const w = 640;
  const h = 200;
  const max = Math.max(1, ...series.map((s) => s.revenuePiasters));
  const step = series.length > 1 ? w / (series.length - 1) : w;
  const points = series
    .map((s, i) => `${i * step},${h - 4 - (Math.max(0, s.revenuePiasters) / max) * (h - 12)}`)
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={label}
      className="h-52 w-full"
      preserveAspectRatio="none"
    >
      {[0, 1, 2, 3].map((i) => (
        <line
          key={i}
          x1="0"
          x2={w}
          y1={(h / 4) * i + 1}
          y2={(h / 4) * i + 1}
          stroke="currentColor"
          strokeOpacity="0.1"
        />
      ))}
      <polyline
        fill="none"
        stroke="#e5641c"
        strokeWidth="3"
        strokeLinejoin="round"
        points={points}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

const card = "rounded-card border border-sand bg-surface p-4 sm:p-5";

export default function AdminOverview({ loaderData }: Route.ComponentProps) {
  const { a, p, lang } = useT();
  const d = a.dashboard;
  const { data, days } = loaderData;
  if (!data) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">{d.title}</h1>
        <p className="rounded-card bg-panel p-6 text-muted">{d.noAccess}</p>
      </div>
    );
  }
  const k = data.kpis;
  const kpis = [
    {
      label: d.netRevenue,
      value: formatEGP(k.netRevenuePiasters, lang),
      icon: Wallet,
      sub: `${d.gross}: ${formatEGP(k.grossPiasters, lang)} · ${d.refunds}: ${formatEGP(k.refundsPiasters, lang)}`,
    },
    { label: d.orders, value: String(k.orders), icon: ShoppingCart, sub: `${d.paidOrders}: ${k.paidOrders}` },
    {
      label: d.avgOrder,
      value: formatEGP(k.averageOrderPiasters, lang),
      icon: Percent,
      sub: `${d.units}: ${k.unitsSold}`,
    },
    ...(k.newCustomers === null
      ? []
      : [{ label: d.newCustomers, value: String(k.newCustomers), icon: UserPlus, sub: "" }]),
  ];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{d.title}</h1>
        <nav aria-label={d.last(days)} className="flex gap-2">
          {RANGES.map((r) => (
            <Link
              key={r}
              to={`?days=${r}`}
              aria-current={r === days}
              className={`rounded-input px-3 py-2 text-sm ${r === days ? "bg-cta text-cta-fg" : "bg-panel hover:bg-sand"}`}
            >
              {d.last(r)}
            </Link>
          ))}
        </nav>
      </div>
      <p className="text-xs text-muted">
        {d.coverage} {d.refreshed}:{" "}
        <time dateTime={data.generatedAt.toISOString()}>
          {data.generatedAt.toLocaleString(lang === "ar" ? "ar-EG" : "en-GB", { timeZone: "Africa/Cairo" })}
        </time>
      </p>
      {data.needsAttention > 0 ? (
        <Link
          to={`/${lang}/admin/orders`}
          role="alert"
          className="block rounded-input border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm"
        >
          {d.attention}: <strong>{data.needsAttention}</strong>
        </Link>
      ) : null}

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((x) => {
          const Icon = x.icon;
          return (
            <li key={x.label} className={`${card} flex items-center gap-4`}>
              <span className="grid size-12 shrink-0 place-items-center rounded-input bg-cta text-cta-fg">
                <Icon className="size-6" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-sm text-muted">{x.label}</p>
                <p className="text-2xl font-bold">{x.value}</p>
                {x.sub ? <p className="text-xs text-muted">{x.sub}</p> : null}
              </div>
            </li>
          );
        })}
        <li className={`${card} text-sm text-muted`}>
          <p className="font-semibold text-fg">{d.conversion}</p>
          <p>{d.conversionNa}</p>
        </li>
      </ul>

      <section className={card} aria-labelledby="trend-h">
        <h2 id="trend-h" className="mb-3 font-bold">
          {d.trend}
        </h2>
        <RevenueChart series={data.series} label={d.trend} />
        <p className="mt-1 flex justify-between text-xs text-muted" dir="ltr">
          <span>{data.series[0]?.day}</span>
          <span>{data.series.at(-1)?.day}</span>
        </p>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className={card} aria-labelledby="top-h">
          <h2 id="top-h" className="mb-3 font-bold">
            {d.topProducts}
          </h2>
          {data.topProducts.length === 0 ? (
            <p className="text-sm text-muted">{d.none}</p>
          ) : (
            <ol className="grid gap-3 text-sm">
              {data.topProducts.map((t, i) => (
                <li key={t.sku} className="flex items-center gap-3">
                  <span className="grid size-6 place-items-center rounded-full bg-cta text-xs font-bold text-cta-fg">
                    {i + 1}
                  </span>
                  <span className="flex-1">{t.name}</span>
                  <span className="text-muted">
                    {t.units} {d.units2} · {formatEGP(t.revenuePiasters, lang)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
        <section className={card} aria-labelledby="br-h">
          <h2 id="br-h" className="mb-3 font-bold">
            {d.branches}
          </h2>
          {data.branches.length === 0 ? (
            <p className="text-sm text-muted">{d.none}</p>
          ) : (
            <ul className="grid gap-3 text-sm">
              {data.branches.map((b) => (
                <li key={b.branchId} className="flex items-center justify-between gap-2">
                  <span>{b.name}</span>
                  <span className="text-muted">
                    {b.orders} · {formatEGP(b.revenuePiasters, lang)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className={card} aria-labelledby="recent-h">
          <h2 id="recent-h" className="mb-3 font-bold">
            {d.recent}
          </h2>
          {data.recentOrders.length === 0 ? (
            <p className="text-sm text-muted">{d.none}</p>
          ) : (
            <ul className="grid gap-2 text-sm">
              {data.recentOrders.map((o) => (
                <li key={o.ref}>
                  <Link
                    to={`/${lang}/admin/orders/${o.ref}`}
                    className="flex flex-wrap items-center justify-between gap-2 hover:underline"
                  >
                    <span dir="ltr" className="font-mono">
                      {o.ref}
                    </span>
                    <span className="text-muted">
                      {p.order.status[o.status as keyof typeof p.order.status]}
                    </span>
                    <span className="font-semibold">{formatEGP(o.totalPiasters, lang)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className={card} aria-labelledby="low-h">
          <h2 id="low-h" className="mb-3 flex items-center gap-2 font-bold">
            <Boxes className="size-5" aria-hidden />
            {d.lowStock}
          </h2>
          {data.lowStock.length === 0 ? (
            <p className="text-sm text-muted">{d.none}</p>
          ) : (
            <ul className="grid gap-2 text-sm">
              {data.lowStock.map((l) => (
                <li key={`${l.sku}-${l.branch}`} className="flex items-center justify-between gap-2">
                  <span>
                    {l.name} <span className="text-xs text-muted">({l.branch})</span>
                  </span>
                  <span className="rounded bg-cta/15 px-2 py-0.5 text-xs text-cta">{l.available}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
