import { expect, test } from "@playwright/test";
import { demoCart } from "./cart-fixture";
import { LOCALES, ROUTES, VIEWPORTS } from "./routes";

for (const lang of LOCALES) {
  for (const route of ROUTES) {
    test(`${lang}${route || "/"}: no horizontal overflow, one h1, correct lang/dir`, async ({ page }) => {
      const cart = await demoCart(["classic-sunglasses", "modern-optical"]);
      await page.addInitScript((c) => localStorage.setItem("shrouk-demo-cart-v2", JSON.stringify(c)), cart);
      for (const width of VIEWPORTS) {
        await page.setViewportSize({ width, height: 900 });
        const response = await page.goto(`/${lang}${route}`);
        expect(response?.status()).toBe(200);
        await page.waitForLoadState("networkidle");
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, `overflow at ${width}px`).toBeLessThanOrEqual(0);
      }
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.locator("html")).toHaveAttribute("lang", lang);
      await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
    });
  }
}
