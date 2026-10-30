import { data, Outlet } from "react-router";
import type { Route } from "./+types/storefront";
import { isLocale } from "~/i18n/config";
import { LocaleProvider, useT } from "~/i18n/context";
import { CartProvider } from "~/lib/cart";
import { Footer } from "~/components/footer";
import { Header } from "~/components/header";

export function loader({ params }: Route.LoaderArgs) {
  if (!isLocale(params.lang)) throw data(null, { status: 404 });
  return { lang: params.lang };
}

export default function StorefrontLayout({ loaderData }: Route.ComponentProps) {
  return (
    <LocaleProvider lang={loaderData.lang}>
      <CartProvider>
        <Shell />
      </CartProvider>
    </LocaleProvider>
  );
}

function Shell() {
  const { t } = useT();
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded-input focus:bg-cta focus:px-3 focus:py-2 focus:text-cta-fg"
      >
        {t.skipToContent}
      </a>
      <Header />
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
