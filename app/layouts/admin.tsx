import { useState } from "react";
import { data, Form, Link, NavLink, Outlet, useLocation } from "react-router";
import {
  Banknote,
  Boxes,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Menu,
  PackageSearch,
  ShoppingCart,
  Store,
  Ticket,
  UserCog,
  Newspaper,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import type { Route } from "./+types/admin";
import { isLocale, switchLocalePath } from "~/i18n/config";
import { LocaleProvider, useT } from "~/i18n/context";
import { ThemeToggle } from "~/components/theme-toggle";
import { can, canAny } from "../../server/auth/rbac";
import { requireStaff } from "../../server/http/session";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  if (!isLocale(params.lang)) throw data(null, { status: 404 });
  const { session, principal, csrf } = await requireStaff(request, context, { lang: params.lang });
  return {
    lang: params.lang,
    csrf,
    user: { displayName: session.user.displayName, email: session.user.email },
    caps: {
      catalog: can(principal, "catalog:read"),
      catalogWrite: can(principal, "catalog:write"),
      staff: can(principal, "staff:read"),
      staffManage: can(principal, "staff:manage"),
      ordersRead: canAny(principal, "orders:read"),
      ordersManage: canAny(principal, "orders:manage"),
      refundsRequest: canAny(principal, "refunds:request"),
      refundsApprove: canAny(principal, "refunds:approve"),
      inventoryRead: canAny(principal, "inventory:read"),
      inventoryWrite: canAny(principal, "inventory:write"),
      financeRead: can(principal, "finance:read"),
      auditRead: can(principal, "audit:read"),
      customersRead: can(principal, "customers:read"),
      couponsManage: can(principal, "coupons:manage"),
      contentWrite: can(principal, "content:write"),
      branchesRead: canAny(principal, "branches:read"),
    },
  };
}

export function meta() {
  return [{ title: "SHROUK Admin" }, { name: "robots", content: "noindex,nofollow" }];
}

export default function AdminLayout({ loaderData }: Route.ComponentProps) {
  return (
    <LocaleProvider lang={loaderData.lang}>
      <AdminShell data={loaderData} />
    </LocaleProvider>
  );
}

type NavItem = { label: string; to?: string; icon: LucideIcon; end?: boolean };

function AdminShell({ data }: { data: Route.ComponentProps["loaderData"] }) {
  const { p, a, t, lang } = useT();
  const { pathname } = useLocation();
  const [openFor, setOpenFor] = useState<string | null>(null);
  const open = openFor === pathname;

  const items: NavItem[] = [
    { label: p.admin.nav[0]!, to: `/${lang}/admin`, icon: LayoutDashboard, end: true },
    ...(data.caps.catalog
      ? [{ label: a.products.title, to: `/${lang}/admin/products`, icon: PackageSearch }]
      : []),
    ...(data.caps.ordersRead
      ? [{ label: a.orders.title, to: `/${lang}/admin/orders`, icon: ShoppingCart }]
      : []),
    ...(data.caps.inventoryRead
      ? [{ label: a.inventory.title, to: `/${lang}/admin/inventory`, icon: Boxes }]
      : []),
    ...(data.caps.branchesRead
      ? [{ label: a.modules.branches, to: `/${lang}/admin/branches`, icon: Store }]
      : []),
    ...(data.caps.customersRead
      ? [{ label: a.modules.customers, to: `/${lang}/admin/customers`, icon: Users }]
      : []),
    ...(data.caps.couponsManage
      ? [{ label: a.modules.coupons, to: `/${lang}/admin/coupons`, icon: Ticket }]
      : []),
    ...(data.caps.contentWrite
      ? [{ label: a.modules.posts, to: `/${lang}/admin/posts`, icon: Newspaper }]
      : []),
    ...(data.caps.financeRead
      ? [{ label: a.modules.finance, to: `/${lang}/admin/finance`, icon: Banknote }]
      : []),
    ...(data.caps.auditRead
      ? [{ label: a.modules.audit, to: `/${lang}/admin/audit`, icon: ClipboardList }]
      : []),
    ...(data.caps.staff ? [{ label: a.staff.title, to: `/${lang}/admin/staff`, icon: UserCog }] : []),
  ];
  const base = "flex items-center gap-3 rounded-input px-3 py-3 text-sm";
  const nav = (
    <ul className="grid gap-1">
      {items.map(({ label, to, icon: Icon, end }) => (
        <li key={label}>
          <NavLink
            to={to!}
            end={end}
            className={({ isActive }) =>
              `${base} ${isActive ? "bg-cta font-semibold text-cta-fg" : "hover:bg-panel"}`
            }
          >
            <Icon className="size-5" aria-hidden />
            {label}
          </NavLink>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="min-h-dvh bg-bg text-fg lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="hidden border-e border-sand bg-surface p-4 lg:block" aria-label="Admin">
        <img
          src="/assets/brand/logo-horizontal-light-outlined.svg"
          alt="SHROUK"
          width={152}
          height={42}
          className="mb-6 h-12 w-auto dark:hidden"
        />
        <img
          src="/assets/brand/logo-horizontal-dark-outlined.svg"
          alt="SHROUK"
          width={152}
          height={42}
          className="mb-6 hidden h-12 w-auto dark:block"
        />
        {nav}
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-sand bg-surface px-4 py-3">
          <button
            type="button"
            aria-expanded={open}
            aria-controls="admin-nav"
            aria-label={open ? p.common.close : p.common.menu}
            onClick={() => setOpenFor(open ? null : pathname)}
            className="grid size-10 place-items-center rounded-full hover:bg-panel lg:hidden"
          >
            {open ? <X className="size-6" aria-hidden /> : <Menu className="size-6" aria-hidden />}
          </button>
          <p className="font-bold lg:hidden">{t.brand}</p>
          <p className="ms-auto hidden text-sm text-muted md:block" dir="ltr">
            {data.user.displayName} · {data.user.email}
          </p>
          <div className="ms-auto flex items-center gap-2 md:ms-0">
            <ThemeToggle />
            <Link
              to={switchLocalePath(pathname, lang === "ar" ? "en" : "ar")}
              reloadDocument
              hrefLang={lang === "ar" ? "en" : "ar"}
              className="rounded-input border border-sand px-3 py-2 text-sm font-medium hover:bg-panel"
            >
              {t.actions.language}
            </Link>
            <Form method="post" action={`/${lang}/admin/logout`}>
              <input type="hidden" name="_csrf" value={data.csrf} />
              <button
                type="submit"
                aria-label={a.auth.logout}
                title={a.auth.logout}
                className="grid size-10 place-items-center rounded-full hover:bg-panel"
              >
                <LogOut className="size-5" aria-hidden />
              </button>
            </Form>
          </div>
        </header>
        {open ? (
          <nav id="admin-nav" aria-label="Admin" className="border-b border-sand bg-surface p-3 lg:hidden">
            {nav}
          </nav>
        ) : null}
        <main className="p-4 sm:p-6">
          <Outlet context={{ csrf: data.csrf, caps: data.caps }} />
        </main>
        <footer className="border-t border-sand px-4 py-3 text-xs text-muted">
          © {new Date().getFullYear()} {t.brand}
        </footer>
      </div>
    </div>
  );
}

export type AdminOutletContext = { csrf: string; caps: Route.ComponentProps["loaderData"]["caps"] };
