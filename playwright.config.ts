import { defineConfig, devices } from "@playwright/test";

const chromium = { ...devices["Desktop Chrome"] };

/**
 * `stateless` only reads. `admin` and `orders` write to the shared dev database and clean up after themselves, so
 * `orders` waits for `admin` (their fixtures would otherwise delete each other's rows).
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  outputDir: "artifacts/test-results",
  use: { baseURL: "http://localhost:5173" },
  projects: [
    {
      name: "stateless",
      testMatch: ["layout.spec.ts", "behaviour.spec.ts", "seo.spec.ts"],
      use: chromium,
    },
    { name: "admin", testMatch: "admin.spec.ts", use: chromium },
    { name: "orders", testMatch: "orders.spec.ts", dependencies: ["admin"], use: chromium },
    { name: "payments", testMatch: "payments.spec.ts", dependencies: ["orders"], use: chromium },
    { name: "modules", testMatch: "modules.spec.ts", dependencies: ["payments"], use: chromium },
    { name: "a11y", testMatch: "a11y.spec.ts", use: chromium },
    { name: "screens", testMatch: "screens.spec.ts", use: chromium },
  ],
  webServer: {
    command: "npm run dev -- --port 5173",
    url: "http://localhost:5173/ar",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
