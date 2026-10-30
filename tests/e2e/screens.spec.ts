import { test } from "@playwright/test";
import { demoCart } from "./cart-fixture";

/** Evidence capture (not an assertion suite): the nine reference pages at 390/1024/1440, Arabic, light and dark. */
const PAGES: [string, string][] = [
  ["01-home", ""],
  ["02-shop", "/c/sunglasses"],
  ["03-product", "/p/classic-sunglasses"],
  ["04-cart", "/cart"],
  ["05-checkout", "/checkout"],
  ["06-branches", "/branches"],
  ["07-about", "/about"],
  ["08-blog", "/blog"],
  ["09-admin-login", "/admin/login"],
];

for (const theme of ["light", "dark"] as const) {
  for (const width of [390, 1024, 1440]) {
    for (const [name, route] of PAGES) {
      test(`screenshot ${name} ${theme} ${width}`, async ({ page, context }) => {
        await context.addCookies([{ name: "theme", value: theme, url: "http://localhost:5173" }]);
        const cart = await demoCart(["classic-sunglasses", "modern-optical", "round-sunglasses"]);
        await page.addInitScript((c) => localStorage.setItem("shrouk-demo-cart-v2", JSON.stringify(c)), cart);
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`/ar${route}`);
        await page.waitForLoadState("networkidle");
        await page.screenshot({ path: `artifacts/screens/${name}-${theme}-${width}.png`, fullPage: true });
      });
    }
  }
}
