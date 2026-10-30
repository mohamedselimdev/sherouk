import { useEffect } from "react";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from "react-router";

import type { Route } from "./+types/root";
import { DEFAULT_LOCALE, DIRECTION, isLocale } from "~/i18n/config";
import { parseThemeCookie, THEME_INIT_SCRIPT } from "~/lib/theme";
import "./styles/app.css";

export function loader({ request }: Route.LoaderArgs) {
  const first = new URL(request.url).pathname.split("/")[1];
  return {
    lang: isLocale(first) ? first : DEFAULT_LOCALE,
    theme: parseThemeCookie(request.headers.get("cookie")),
  };
}

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/assets/brand/favicon.svg", type: "image/svg+xml" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRouteLoaderData<typeof loader>("root");
  const lang = data?.lang ?? DEFAULT_LOCALE;
  const theme = data?.theme ?? "system";
  return (
    <html
      lang={lang}
      dir={DIRECTION[lang]}
      data-theme={theme === "system" ? undefined : theme}
      suppressHydrationWarning
    >
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  useEffect(() => {
    // Lets end-to-end tests wait until React handlers are attached.
    document.documentElement.dataset.hydrated = "true";
  }, []);
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  return (
    <main className="mx-auto max-w-xl px-4 py-24 text-center">
      <h1 className="text-3xl font-bold">{notFound ? "404" : "Error"}</h1>
      <p className="mt-3 text-muted">
        {notFound ? "Page not found | الصفحة غير موجودة" : "Something went wrong | حدث خطأ"}
      </p>
    </main>
  );
}
