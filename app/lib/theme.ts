export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_COOKIE = "theme";

export function isTheme(value: string | undefined): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

export function parseThemeCookie(cookieHeader: string | null): Theme {
  const match = cookieHeader?.match(new RegExp(`(?:^|;\\s*)${THEME_COOKIE}=([^;]+)`));
  const value = match?.[1];
  return isTheme(value) ? value : "system";
}

/** Runs before first paint: resolves `system` to the OS preference so there is no theme flash. */
export const THEME_INIT_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|;\\s*)${THEME_COOKIE}=([^;]+)/);var t=m?m[1]:"system";if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t;}catch(e){}})();`;
