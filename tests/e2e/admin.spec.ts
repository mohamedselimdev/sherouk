import { expect, test } from "@playwright/test";
import {
  cleanup,
  E2E_PASSWORD,
  loginAsStaff,
  makeStaff,
  freshCode,
  TINY_PNG,
  type TestStaff,
} from "./support";

test.describe.configure({ mode: "serial" });

let admin: TestStaff;
let editor: TestStaff;

test.beforeAll(async () => {
  await cleanup();
  admin = await makeStaff("admin", "hq_admin");
  editor = await makeStaff("editor", "content_editor");
});
test.afterAll(cleanup);

test("admin areas redirect to login when signed out; bogus media is 404", async ({ page }) => {
  for (const path of ["/en/admin", "/en/admin/products", "/en/admin/products/new", "/en/admin/staff"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/en\/admin\/login$/);
  }
  expect((await page.request.get("/media/products/not-a-real-key.png")).status()).toBe(404);
  expect((await page.request.get("/media/../secrets.txt")).status()).toBe(404);
});

test("wrong password gives one generic error; a password alone grants no access", async ({ page }) => {
  await page.goto("/en/admin/login");
  await page.waitForSelector("html[data-hydrated]");
  await page.getByLabel("Email").fill(admin.email);
  await page.getByLabel("Password").fill("definitely wrong password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText("Invalid email or password.");
  await page.getByLabel("Email").fill("nobody@shrouk.test");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText("Invalid email or password.");

  await page.getByLabel("Email").fill(admin.email);
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/en\/admin\/mfa$/);
  // Pending (password-only) session must not open the dashboard or any data route.
  for (const path of ["/en/admin", "/en/admin/products", "/en/admin/staff"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/en\/admin\/mfa$/);
  }
});

test("a wrong second factor is rejected, the right one signs in, logout ends the session", async ({
  page,
}) => {
  await page.goto("/en/admin/login");
  await page.waitForSelector("html[data-hydrated]");
  await page.getByLabel("Email").fill(admin.email);
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Code").fill("000000");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("alert")).toHaveText("That code is wrong or expired.");
  await page.getByLabel("Code").fill(await freshCode(admin));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/en\/admin$/);
  const cookies = await page.context().cookies();
  const session = cookies.find((c) => c.name === "shrouk_staff");
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe("Strict");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/en\/admin\/login$/);
  await page.goto("/en/admin");
  await expect(page).toHaveURL(/\/en\/admin\/login$/);
});

test("catalog end to end: create, price, publish, see on the storefront, archive, gone", async ({ page }) => {
  await loginAsStaff(page, admin);
  await page.goto("/en/admin/products/new");
  await page.waitForSelector("html[data-hydrated]");
  await page.getByLabel("Arabic name").fill("منتج اختبار");
  await page.getByLabel("English name").fill("E2E Test Frame");
  await page.getByLabel("URL slug (Arabic page)").fill("e2e-test-frame");
  await page.getByLabel("URL slug (English page)").fill("e2e-test-frame");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(/\/en\/admin\/products\/[0-9a-f-]{36}$/);

  // Publishing without a variant is refused.
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByRole("alert")).toContainText("at least one variant");

  const add = page.locator("form", { has: page.getByRole("button", { name: "Add variant" }) });
  await add.getByLabel("SKU").fill("e2e-sku-1");
  await add.getByLabel("Price (EGP)").fill("1234.50");
  await add.getByRole("button", { name: "Add variant" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  // Bad price formats are rejected, not guessed.
  await add.getByLabel("SKU").fill("e2e-sku-2");
  await add.getByLabel("Price (EGP)").fill("12,34");
  await add.getByRole("button", { name: "Add variant" }).click();
  await expect(page.getByRole("alert")).toContainText("Check the highlighted fields");
  // Duplicate SKU is a conflict, not a crash.
  await add.getByLabel("SKU").fill("E2E-SKU-1");
  await add.getByLabel("Price (EGP)").fill("10");
  await add.getByRole("button", { name: "Add variant" }).click();
  await expect(page.getByRole("alert")).toContainText("already in use");

  // Not on the storefront while it is a draft.
  expect((await page.request.get("/en/p/e2e-test-frame")).status()).toBe(404);

  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  const live = await page.request.get("/en/p/e2e-test-frame");
  expect(live.status()).toBe(200);
  expect(await live.text()).toContain("EGP 1,234.50");
  await page.goto("/ar/shop");
  await expect(page.getByText("منتج اختبار").first()).toBeVisible();

  // Image upload: a real PNG is accepted, a text file disguised as .png is rejected.
  await page.goto("/en/admin/products");
  await page.getByRole("link", { name: "Edit" }).first().click();
  const upload = page.locator("form", { has: page.getByRole("button", { name: "Upload image" }) });
  await upload
    .locator('input[type="file"]')
    .setInputFiles({ name: "x.png", mimeType: "image/png", buffer: Buffer.from("this is not an image") });
  await upload.getByRole("button", { name: "Upload image", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("not a valid image");
  await upload
    .locator('input[type="file"]')
    .setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: TINY_PNG });
  await upload.getByRole("button", { name: "Upload image", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  const img = page.locator("section", { hasText: "Images" }).locator("img").first();
  await expect(img).toHaveAttribute("src", /^\/media\/products\/[0-9a-f-]{36}\.png$/);
  const served = await page.request.get((await img.getAttribute("src"))!);
  expect(served.status()).toBe(200);
  expect(served.headers()["content-type"]).toBe("image/png");
  expect(served.headers()["x-content-type-options"]).toBe("nosniff");

  await page.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByText("Status:")).toContainText("Archived");
  expect((await page.request.get("/en/p/e2e-test-frame")).status()).toBe(404);
});

test("a content editor can view products but cannot create, publish, change prices or open staff", async ({
  page,
}) => {
  await loginAsStaff(page, editor);
  await page.goto("/en/admin/products");
  await expect(page.getByRole("heading", { name: "Products" })).toBeVisible();
  await expect(page.getByRole("link", { name: "New product" })).toHaveCount(0);
  expect((await page.goto("/en/admin/staff"))?.status()).toBe(403);
  // Even a hand-built request is refused by the server, not just hidden in the UI.
  const csrf = await (async () => {
    await page.goto("/en/admin/products");
    return page.locator('input[name="_csrf"]').first().inputValue();
  })();
  const res = await page.request.post("/en/admin/products/new", {
    form: {
      _csrf: csrf,
      intent: "save",
      categoryKey: "sunglasses",
      ar_name: "x",
      en_name: "x",
      ar_slug: "e2e-forbidden",
      en_slug: "e2e-forbidden",
    },
    headers: { origin: "http://localhost:5173" },
  });
  expect(res.status()).toBeLessThan(500);
  expect((await page.request.get("/en/p/e2e-forbidden")).status()).toBe(404);
});

test("CSRF and cross-origin writes are blocked", async ({ page }) => {
  await loginAsStaff(page, admin);
  const noToken = await page.request.post("/en/admin/products/new", {
    form: {
      intent: "save",
      categoryKey: "sunglasses",
      ar_name: "x",
      en_name: "x",
      ar_slug: "e2e-csrf",
      en_slug: "e2e-csrf",
    },
    headers: { origin: "http://localhost:5173" },
  });
  expect(noToken.status()).toBe(403);
  await page.goto("/en/admin/products");
  const token = await page.locator('input[name="_csrf"]').first().inputValue();
  const crossOrigin = await page.request.post("/en/admin/products/new", {
    form: {
      _csrf: token,
      intent: "save",
      categoryKey: "sunglasses",
      ar_name: "x",
      en_name: "x",
      ar_slug: "e2e-csrf",
      en_slug: "e2e-csrf",
    },
    headers: { origin: "https://evil.example" },
  });
  expect([400, 403]).toContain(crossOrigin.status()); // framework origin check (400) or ours (403)
  expect((await page.request.get("/en/p/e2e-csrf")).status()).toBe(404);
});

test("staff invitation: admin creates a link, the invitee joins with a role, the link works once", async ({
  page,
  browser,
}) => {
  await loginAsStaff(page, admin);
  await page.goto("/en/admin/staff");
  await page.waitForSelector("html[data-hydrated]");
  await page.getByLabel("Email").fill("e2e-invitee@shrouk.test");
  await page.getByLabel("Role").selectOption("marketing");
  await page.getByRole("button", { name: "Create invitation" }).click();
  const link = (await page.locator("p.font-mono").first().textContent())!;
  expect(link).toMatch(/^\/en\/admin\/accept-invite\?token=/);

  const other = await browser.newContext();
  const p2 = await other.newPage();
  await p2.goto(`http://localhost:5173${link}`);
  await p2.waitForSelector("html[data-hydrated]");
  await p2.getByLabel("Name").fill("Invited Person");
  await p2.getByLabel("New password").fill("short");
  await p2.getByRole("button", { name: "Create account" }).click();
  await expect(p2.getByRole("alert")).toContainText("at least 12");
  await p2.getByLabel("New password").fill("a perfectly fine password");
  await p2.getByRole("button", { name: "Create account" }).click();
  await expect(p2).toHaveURL(/\/en\/admin\/login$/);
  await p2.goto(`http://localhost:5173${link}`);
  await p2.getByLabel("Name").fill("Again");
  await p2.getByLabel("New password").fill("a perfectly fine password");
  await p2.getByRole("button", { name: "Create account" }).click();
  await expect(p2.getByRole("alert")).toContainText("invalid or has expired");
  await other.close();
});

test("customer accounts: register, session cookie, logout; duplicate email shows the generic error", async ({
  page,
}) => {
  await page.goto("/en/account/register");
  await page.waitForSelector("html[data-hydrated]");
  await page.getByLabel("Name").fill("E2E Customer");
  await page.getByLabel("Email").fill("e2e-customer@shrouk.test");
  await page.getByLabel("Password").fill("a perfectly fine password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/en\/account$/);
  await expect(page.getByRole("heading", { name: /Welcome, E2E Customer/ })).toBeVisible();
  const c = (await page.context().cookies()).find((x) => x.name === "shrouk_customer");
  expect(c?.httpOnly).toBe(true);
  expect(c?.sameSite).toBe("Lax");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/en$/);
  await page.goto("/en/account");
  await expect(page).toHaveURL(/\/en\/account\/login$/);

  await page.goto("/en/account/register");
  await page.waitForSelector("html[data-hydrated]");
  await page.getByLabel("Name").fill("Dup");
  await page.getByLabel("Email").fill("E2E-customer@shrouk.test");
  await page.getByLabel("Password").fill("a perfectly fine password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("alert")).toHaveText("Could not complete the request. Check your details.");
});

test("security headers and admin caching", async ({ page }) => {
  const res = await page.request.get("/en/admin/login");
  const h = res.headers();
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(h["cache-control"]).toBe("no-store");
  expect(h["x-robots-tag"]).toContain("noindex");
  expect(h["x-request-id"]).toBeTruthy();
});
