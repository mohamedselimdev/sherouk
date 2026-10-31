import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const PAGES = [
  "",
  "/shop",
  "/cart",
  "/checkout",
  "/branches",
  "/about",
  "/blog",
  "/contact",
  "/account/login",
];

for (const lang of ["en", "ar"]) {
  for (const theme of ["light", "dark"]) {
    for (const path of PAGES) {
      test(`axe: /${lang}${path} (${theme})`, async ({ page, context }) => {
        await context.addCookies([{ name: "theme", value: theme, url: "http://localhost:5173" }]);
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.goto(`/${lang}${path}`);
        await page.waitForFunction(() => document.documentElement.dataset.hydrated === "true");
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        const summary = results.violations.map(
          (v) =>
            `${v.id} (${v.impact}): ${v.nodes.length} — ${v.nodes[0]?.target.join(" ")} ${v.nodes[0]?.any[0]?.message ?? ""}`,
        );
        expect(summary, summary.join("\n")).toEqual([]);
      });
    }
  }
}
