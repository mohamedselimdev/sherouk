import { eq } from "drizzle-orm";
import { expect, test } from "@playwright/test";
import { branches } from "../../db/schema";
import { createDb } from "../../server/db";
import { createOrder } from "../../server/orders/service";
import { cleanup, loginAsStaff, makeStaff, type TestStaff } from "./support";
import { resetOrdersAndStock, seededProduct } from "./orders-support";

test.describe.configure({ mode: "serial" });

const DEV_URL = "postgres://shrouk:shrouk_local_only@127.0.0.1:54329/shrouk_dev";

let hq: TestStaff;
let finance: TestStaff;
let support: TestStaff;
let managerZamalek: TestStaff;
let zamalek: string;
let nasr: string;

test.beforeAll(async () => {
  await cleanup();
  await resetOrdersAndStock();
  const { db, close } = createDb(DEV_URL, 2);
  try {
    zamalek = (
      await db.select({ id: branches.id }).from(branches).where(eq(branches.slug, "demo-zamalek"))
    )[0]!.id;
    nasr = (
      await db.select({ id: branches.id }).from(branches).where(eq(branches.slug, "demo-nasr-city"))
    )[0]!.id;
    const product = await seededProduct("classic-sunglasses");
    const variantId = product.colors[0]!.variantId;
    const order = (pickupBranch: string, name: string) => ({
      idempotencyKey: `e2e-modules-${name}-${Date.now()}-abcdef`,
      lines: [{ variantId, quantity: 1 }],
      contact: { name, phone: "01012345678" },
      delivery: { method: "pickup", branchId: pickupBranch },
      paymentMethod: "cod",
      locale: "en",
    });
    await createOrder(db, order(zamalek, "E2E Zamalek Buyer"), { allowCod: true });
    await createOrder(db, order(nasr, "E2E Nasr Buyer"), { allowCod: true });
  } finally {
    await close();
  }
  hq = await makeStaff("mod-hq", "hq_admin");
  finance = await makeStaff("mod-fin", "finance");
  support = await makeStaff("mod-sup", "customer_support");
  managerZamalek = await makeStaff("mod-mgr", "branch_manager", zamalek);
});
test.afterAll(async () => {
  await resetOrdersAndStock();
  await cleanup();
});

test("the dashboard shows real figures from the database, not constants", async ({ page }) => {
  await loginAsStaff(page, hq);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("Figures cover online orders only")).toBeVisible();
  await expect(page.getByText("Not available: needs analytics data")).toBeVisible();
  // Two COD orders exist (one per branch) and nothing is collected yet.
  await expect(page.locator("main li", { hasText: "Paid orders:" })).toContainText("2");
  await expect(page.getByText("Collected: EGP 0")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Branch performance" })).toBeVisible();
  await page.getByRole("link", { name: "Last 7 days" }).click();
  await expect(page).toHaveURL(/days=7/);
});

test("a branch manager sees only their own branch in orders, branches and the dashboard", async ({
  page,
}) => {
  await loginAsStaff(page, managerZamalek);
  await expect(page.locator("main li", { hasText: "Paid orders:" })).toContainText("1");
  await page.goto("/en/admin/orders");
  await expect(page.locator("main ul li a")).toHaveCount(1);
  await expect(page.getByText("E2E Zamalek Buyer")).toBeVisible();
  await expect(page.getByText("E2E Nasr Buyer")).toHaveCount(0);
  await page.goto("/en/admin/branches");
  await expect(page.locator("main form")).toHaveCount(1);
  // No finance, audit or staff areas for this role (server answers 403, not just a hidden link).
  for (const path of ["/en/admin/finance", "/en/admin/audit", "/en/admin/staff", "/en/admin/finance.csv"]) {
    expect((await page.goto(path))?.status()).toBe(403);
  }
});

test("branch edits are saved for the own branch and refused for another", async ({ page }) => {
  await loginAsStaff(page, managerZamalek);
  await page.goto("/en/admin/branches");
  await page.waitForSelector("html[data-hydrated]");
  await page.getByLabel("Branch phone").fill("+20 10 0000 7777");
  await page.getByLabel("Sunday Opens").fill("09:30");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await page.reload();
  await expect(page.getByLabel("Branch phone")).toHaveValue("+20 10 0000 7777");

  // A hand-built request for another branch is refused by the server.
  const csrf = await page.locator('input[name="_csrf"]').first().inputValue();
  const res = await page.request.post("/en/admin/branches", {
    form: { _csrf: csrf, branchId: nasr, phone: "+20 10 0000 9999", pickupEnabled: "on" },
    headers: { origin: "http://localhost:5173" },
  });
  expect(res.status()).toBeLessThan(500);
  const { db, close } = createDb(DEV_URL, 1);
  try {
    const [b] = await db.select().from(branches).where(eq(branches.id, nasr));
    expect(b!.phone).toBe("+20 10 0000 0002");
  } finally {
    await close();
  }
});

test("finance: summary, CSV export with a header row, and the export lands in the audit log", async ({
  page,
}) => {
  await loginAsStaff(page, finance);
  await page.goto("/en/admin/finance");
  await expect(page.getByRole("heading", { name: "Finance" })).toBeVisible();
  await expect(page.getByText("Cash due on delivery (not yet collected)")).toBeVisible();
  const csv = await page.request.get("/en/admin/finance.csv?days=30");
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(csv.headers()["content-disposition"]).toContain("attachment");
  expect(await csv.text()).toContain("date_cairo,order,type,method,amount_egp,reference");
  await page.getByRole("link", { name: "Audit log" }).click();
  await expect(page.getByText("finance.export").first()).toBeVisible();
  await page.getByPlaceholder("Filter by action (e.g. catalog.)").fill("finance.");
  await page.getByRole("button", { name: "Action" }).click();
  await expect(page.locator("main li").first()).toContainText("finance.export");
});

test("support can read customers but not finance or the audit log", async ({ page }) => {
  await loginAsStaff(page, support);
  expect((await page.goto("/en/admin/customers"))?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Customers" })).toBeVisible();
  expect((await page.goto("/en/admin/finance"))?.status()).toBe(403);
  expect((await page.goto("/en/admin/audit"))?.status()).toBe(403);
});

test("arabic admin pages render right-to-left with translated labels", async ({ page }) => {
  await loginAsStaff(page, hq, "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: "نظرة عامة" })).toBeVisible();
  await page.goto("/ar/admin/finance");
  await expect(page.getByRole("heading", { name: "المالية" })).toBeVisible();
});
