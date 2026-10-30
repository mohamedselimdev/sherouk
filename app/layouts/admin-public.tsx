import { data, Outlet } from "react-router";
import type { Route } from "./+types/admin-public";
import { isLocale } from "~/i18n/config";
import { LocaleProvider, useT } from "~/i18n/context";
import { ThemeToggle } from "~/components/theme-toggle";

export function loader({ params }: Route.LoaderArgs) {
  if (!isLocale(params.lang)) throw data(null, { status: 404 });
  return { lang: params.lang };
}

export function meta() {
  return [{ title: "SHROUK" }, { name: "robots", content: "noindex,nofollow" }];
}

export default function AdminPublicLayout({ loaderData }: Route.ComponentProps) {
  return (
    <LocaleProvider lang={loaderData.lang}>
      <Frame />
    </LocaleProvider>
  );
}

function Frame() {
  const { t } = useT();
  return (
    <div className="grid min-h-dvh place-items-center bg-bg px-4 py-10 text-fg">
      <main className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-between">
          <img
            src="/assets/brand/logo-horizontal-light-outlined.svg"
            alt="SHROUK"
            width={152}
            height={42}
            className="h-12 w-auto dark:hidden"
          />
          <img
            src="/assets/brand/logo-horizontal-dark-outlined.svg"
            alt="SHROUK"
            width={152}
            height={42}
            className="hidden h-12 w-auto dark:block"
          />
          <ThemeToggle />
        </div>
        <div className="rounded-card border border-sand bg-surface p-6 shadow-soft">
          <Outlet />
        </div>
        <p className="mt-4 text-center text-xs text-muted">{t.brand}</p>
      </main>
    </div>
  );
}
