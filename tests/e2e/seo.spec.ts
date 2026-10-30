import { expect, test } from "@playwright/test";

test.describe("seo (non-production env)", () => {
  test("robots.txt blocks everything outside production", async ({ request }) => {
    const r = await request.get("/robots.txt");
    expect(r.status()).toBe(200);
    expect(await r.text()).toContain("Disallow: /");
  });

  test("sitemap is empty outside production", async ({ request }) => {
    const r = await request.get("/sitemap.xml");
    expect(r.status()).toBe(200);
    expect(await r.text()).not.toContain("<loc>");
  });

  test("home carries canonical, hreflang and noindex", async ({ page }) => {
    await page.goto("/ar");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/ar$/);
    await expect(page.locator('link[rel="alternate"][hreflang="en-EG"]')).toHaveCount(1);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex,nofollow");
  });

  test("product page has Product JSON-LD with an EGP offer", async ({ page }) => {
    await page.goto("/en/shop");
    const href = await page.locator('a[href*="/en/p/"]').first().getAttribute("href");
    await page.goto(href!);
    const raw = await page.locator('script[type="application/ld+json"]').allTextContents();
    const product = raw.map((t) => JSON.parse(t)).find((j) => j["@type"] === "Product");
    expect(product.offers.priceCurrency).toBe("EGP");
    expect(product.offers.availability).toMatch(/schema\.org\/(InStock|OutOfStock)/);
  });
});
