export const LOCALES = ["ar", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "ar";

export const DIRECTION: Record<Locale, "rtl" | "ltr"> = { ar: "rtl", en: "ltr" };
export const HREFLANG: Record<Locale, string> = { ar: "ar-EG", en: "en-EG" };

export function isLocale(value: string | undefined): value is Locale {
  return value === "ar" || value === "en";
}

/** Swaps the leading locale segment of a pathname; non-localised paths get the locale prepended. */
export function switchLocalePath(pathname: string, to: Locale): string {
  const segments = pathname.split("/").filter(Boolean);
  const rest = isLocale(segments[0]) ? segments.slice(1) : segments;
  return "/" + [to, ...rest].join("/");
}
