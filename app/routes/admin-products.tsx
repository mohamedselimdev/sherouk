import { Link, useOutletContext } from "react-router";
import { Plus } from "lucide-react";
import type { Route } from "./+types/admin-products";
import type { AdminOutletContext } from "~/layouts/admin";
import { useT } from "~/i18n/context";
import { formatEGP } from "~/lib/format";
import { btnPrimary } from "~/components/ui";
import { listAdminProducts } from "../../server/catalog/admin";
import { requireStaff } from "../../server/http/session";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { principal, scope } = await requireStaff(request, context, {
    lang: params.lang,
    permission: "catalog:read",
  });
  return { products: await listAdminProducts(scope.db, principal) };
}

const statusCls = {
  draft: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  published: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  archived: "bg-zinc-500/15 text-muted",
} as const;

export default function AdminProducts({ loaderData }: Route.ComponentProps) {
  const { a, lang } = useT();
  const { caps } = useOutletContext<AdminOutletContext>();
  const { products } = loaderData;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{a.products.title}</h1>
        {caps.catalogWrite ? (
          <Link to={`/${lang}/admin/products/new`} className={btnPrimary}>
            <Plus className="size-4" aria-hidden />
            {a.products.new}
          </Link>
        ) : null}
      </div>
      {products.length === 0 ? (
        <p className="rounded-card bg-panel p-8 text-center text-muted">{a.products.none}</p>
      ) : (
        <>
          <table className="hidden w-full text-sm md:table">
            <thead className="text-muted">
              <tr>
                {[
                  a.products.name,
                  a.products.category,
                  a.products.status,
                  a.products.fromPrice,
                  a.products.variants,
                  "",
                ].map((h, i) => (
                  <th key={i} scope="col" className="pb-2 text-start font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className="border-t border-sand">
                  <td className="py-3 font-medium">{lang === "ar" ? p.nameAr : p.nameEn}</td>
                  <td>{p.category}</td>
                  <td>
                    <span className={`rounded px-2 py-0.5 text-xs ${statusCls[p.status]}`}>
                      {a.products.statuses[p.status]}
                    </span>
                  </td>
                  <td>{p.minPrice === null ? "—" : formatEGP(p.minPrice, lang)}</td>
                  <td>{p.variants}</td>
                  <td className="text-end">
                    <Link to={`/${lang}/admin/products/${p.id}`} className="text-cta underline">
                      {a.products.edit}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="grid gap-3 md:hidden">
            {products.map((p) => (
              <li key={p.id} className="rounded-card border border-sand bg-surface p-4 text-sm">
                <p className="flex items-start justify-between gap-2 font-semibold">
                  <span>{lang === "ar" ? p.nameAr : p.nameEn}</span>
                  <span className={`rounded px-2 py-0.5 text-xs ${statusCls[p.status]}`}>
                    {a.products.statuses[p.status]}
                  </span>
                </p>
                <p className="mt-1 text-muted">
                  {p.category} · {p.minPrice === null ? "—" : formatEGP(p.minPrice, lang)} · {p.variants}
                </p>
                <Link to={`/${lang}/admin/products/${p.id}`} className="mt-2 inline-block text-cta underline">
                  {a.products.edit}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
