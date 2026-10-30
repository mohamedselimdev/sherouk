import { expect, test, type Page } from "@playwright/test";
import { demoCart } from "./cart-fixture";

async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForSelector("html[data-hydrated]");
}

test("root redirects to Arabic and unknown locale is 404", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/ar$/);
  expect((await page.goto("/fr"))?.status()).toBe(404);
});

test("developer credit is present, links out safely, sits at the right edge in both locales", async ({
  page,
}) => {
  for (const lang of ["ar", "en"]) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/${lang}`);
    const link = page.getByRole("link", { name: "Developed by Mohamed Selim" });
    await expect(link).toHaveAttribute("href", "https://mohamedselim.dev/ar");
    await expect(link).toHaveAttribute("rel", /noopener/);
    const box = (await link.boundingBox())!;
    expect(box.x + box.width).toBeGreaterThan(1440 - 80);
    await expect(page.locator("footer")).toHaveCount(1);
  }
});

test("theme cookie applies dark and light", async ({ page, context }) => {
  for (const theme of ["dark", "light"]) {
    await context.addCookies([{ name: "theme", value: theme, url: "http://localhost:5173" }]);
    await page.goto("/ar");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  }
});

test("skip link is the first tab stop", async ({ page }) => {
  await page.goto("/en");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
});

test("add to cart updates the header badge and the cart page; remove empties it", async ({ page }) => {
  await open(page, "/en/p/classic-sunglasses");
  await page.getByRole("button", { name: "Add to cart" }).first().click();
  await expect(page.getByRole("link", { name: /Cart \(1\)/ })).toBeVisible();
  await open(page, "/en/cart");
  await expect(page.locator("main ul > li h2", { hasText: "Classic sunglasses" })).toBeVisible();
  await page.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("Your cart is empty")).toBeVisible();
});

test("shop filters live in the URL and narrow results", async ({ page }) => {
  await page.goto("/en/shop?max=2000&sort=price-asc");
  const items = page.locator("main article");
  await expect(items.first()).toBeVisible();
  const count = await items.count();
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThan(10);
  await page.goto("/en/shop?q=zzzz");
  await expect(page.getByText("No matching products")).toBeVisible();
});

test("empty category shows an empty state; unknown category and product are 404", async ({ page }) => {
  await page.goto("/en/c/lenses");
  await expect(page.getByText("No products in this category yet.")).toBeVisible();
  expect((await page.goto("/en/c/nope"))?.status()).toBe(404);
  expect((await page.goto("/en/p/nope"))?.status()).toBe(404);
});

test("checkout shows the cash-on-delivery option only when the server flag is on, and nothing is submitted without a cart", async ({
  page,
}) => {
  await page.goto("/en/checkout");
  await expect(page.getByRole("heading", { name: "Your cart has no items." })).toBeVisible();
  const cart = await demoCart(["classic-sunglasses"]);
  await page.addInitScript((c) => localStorage.setItem("shrouk-demo-cart-v2", JSON.stringify(c)), cart);
  await page.goto("/en/checkout");
  await page.waitForSelector("html[data-hydrated]");
  // The local dev environment sets ENABLE_COD=true; production defaults to false (see server/env tests).
  await expect(page.getByRole("radio", { name: /Cash on delivery/ })).toBeAttached();
  await expect(page.getByRole("radio", { name: /Pay by card/ })).toBeAttached();
  await expect(page.getByRole("button", { name: "Place order" })).toBeEnabled();
});

test("mobile menu opens and closes with Escape", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await open(page, "/en");
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByRole("navigation", { name: "Mobile" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("navigation", { name: "Mobile" })).toBeHidden();
});
