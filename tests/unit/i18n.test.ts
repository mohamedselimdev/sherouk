import { describe, expect, it } from "vitest";
import { DIRECTION, isLocale, switchLocalePath } from "~/i18n/config";
import { dictionaries } from "~/i18n/dictionary";
import { pages } from "~/i18n/pages";
import { adminDict } from "~/i18n/admin";

function keys(obj: object, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === "object" && v !== null ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe("i18n", () => {
  it("has identical dictionary keys in ar and en", () => {
    expect(keys(dictionaries.ar).sort()).toEqual(keys(dictionaries.en).sort());
  });
  it("has identical page-copy keys in ar and en", () => {
    expect(keys(pages.ar).sort()).toEqual(keys(pages.en).sort());
  });
  it("has identical admin/auth copy keys in ar and en", () => {
    expect(keys(adminDict.ar).sort()).toEqual(keys(adminDict.en).sort());
  });
  it("sets direction per locale", () => {
    expect(DIRECTION).toEqual({ ar: "rtl", en: "ltr" });
  });
  it("validates locales", () => {
    expect(isLocale("ar")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
  it("switches locale in paths", () => {
    expect(switchLocalePath("/ar", "en")).toBe("/en");
    expect(switchLocalePath("/ar/shop/x", "en")).toBe("/en/shop/x");
    expect(switchLocalePath("/shop", "ar")).toBe("/ar/shop");
  });
});
