import { describe, expect, it } from "vitest";
import { pageMeta, productJsonLd, siteOrigin } from "../../app/lib/seo";

const base = {
  siteUrl: "https://shrouk.example",
  paths: { ar: "/ar/p/a", en: "/en/p/a" },
  title: "T",
};

describe("seo", () => {
  it("strips trailing slash", () => {
    expect(siteOrigin("https://x.test/")).toBe("https://x.test");
    expect(siteOrigin("https://x.test")).toBe("https://x.test");
  });

  it("emits canonical, both hreflang alternates and x-default", () => {
    const m = pageMeta({ ...base, lang: "en", index: true });
    expect(m).toContainEqual({ tagName: "link", rel: "canonical", href: "https://shrouk.example/en/p/a" });
    const alts = m.filter((x) => x.rel === "alternate").map((x) => x.hrefLang);
    expect(alts).toEqual(["ar-EG", "en-EG", "x-default"]);
    expect(m).toContainEqual({ name: "robots", content: "index,follow" });
  });

  it("is noindex when not production", () => {
    expect(pageMeta({ ...base, lang: "ar", index: false })).toContainEqual({
      name: "robots",
      content: "noindex,nofollow",
    });
  });

  it("builds Offer from real price and stock", () => {
    const ld = productJsonLd({
      siteUrl: "https://s.test",
      url: "https://s.test/p",
      name: "N",
      sku: "S",
      pricePiasters: 125050,
      inStock: false,
    });
    const offer = ld.offers as { price: string; availability: string; priceCurrency: string };
    expect(offer.price).toBe("1250.50");
    expect(offer.availability).toBe("https://schema.org/OutOfStock");
    expect(offer.priceCurrency).toBe("EGP");
    expect(ld).not.toHaveProperty("aggregateRating");
  });
});
