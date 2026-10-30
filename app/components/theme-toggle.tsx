import { useEffect, useState } from "react";
import { useRouteLoaderData } from "react-router";
import { THEME_COOKIE, THEMES, type Theme } from "~/lib/theme";
import { useT } from "~/i18n/context";
import type { loader as rootLoader } from "~/root";

function applyTheme(theme: Theme) {
  const resolved =
    theme === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme;
  document.documentElement.dataset.theme = resolved;
  document.cookie = `${THEME_COOKIE}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

export function ThemeToggle() {
  const { t } = useT();
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const [theme, setTheme] = useState<Theme>(root?.theme ?? "system");

  useEffect(() => {
    if (theme !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">{t.actions.theme}</span>
      <select
        value={theme}
        onChange={(e) => {
          const next = e.target.value as Theme;
          setTheme(next);
          applyTheme(next);
        }}
        className="rounded-input border border-sand bg-surface px-2 py-2 text-sm"
      >
        {THEMES.map((value) => (
          <option key={value} value={value}>
            {t.theme[value]}
          </option>
        ))}
      </select>
    </label>
  );
}
