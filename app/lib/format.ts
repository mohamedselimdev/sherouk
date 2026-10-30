import type { Locale } from "~/i18n/config";

const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const fractional = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Formats an amount given in integer piasters, e.g. 245000 -> "EGP 2,450" / "2,450 ج.م".
 * Latin digits in both locales, as in the design boards; decimals only when there are piasters.
 */
export function formatEGP(piasters: number, lang: Locale): string {
  const pounds = piasters / 100;
  const text = Number.isInteger(pounds) ? whole.format(pounds) : fractional.format(pounds);
  return lang === "ar" ? `${text} ج.م` : `EGP ${text}`;
}
