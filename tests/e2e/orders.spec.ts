import { expect, test } from "@playwright/test";
import { cleanup, loginAsStaff, makeStaff, type TestStaff } from "./support";
import { demoBranchIds, orderCount, resetOrdersAndStock, seededProduct, setStock } from "./orders-support";

test.describe.configure({ mode: "serial" });

let admin: TestStaff;

test.beforeAll(async () => {
  await cleanup();
  await resetOrdersAndStock();
  admin = await makeStaff("orders-admin", "hq_admin");
});
test.afterAll(async () => {
  await resetOrdersAndStock();
  await cleanup();
});

const ORIGIN = { origin: "http://localhost:5173" };

test("the quote API prices on the server and rejects tampering", async ({ request }) => {
  const product = await seededProduct("classic-sunglasses");
  const variantId = product.colors[0]!.variantId;
  const ok = await request.post("/en/api/quote", {
    data: {
      lines: [{ variantId, quantity: 2 }],
      governorate: "cairo",
      couponCode: "welcome10",
      deliveryMethod: "delivery",
    },
    headers: ORIGIN,
  });
  expect(ok.status()).toBe(200);
  const { quote } = await ok.json();
  expect(quote.subtotalPiasters).toBe(2 * 245000);
  expect(quote.discountPiasters).toBe(49000);
  expect(quote.shippingPiasters).toBe(7000); // 4,900 EGP is below the 5,000 EGP free-shipping threshold
});

test("quote: shipping fee, bad variant, bad coupon, extra price fields and foreign origins", async ({
  request,
}) => {
  const product = await seededProduct("classic-sunglasses");
  const variantId = product.colors[0]!.variantId;
  const base = { lines: [{ variantId, quantity: 1 }], governorate: "cairo", deliveryMethod: "delivery" };
  const q = await (await request.post("/en/api/quote", { data: base, headers: ORIGIN })).json();
  expect(q.quote.shippingPiasters).toBe(7000);
  expect(q.quote.totalPiasters).toBe(245000 + 7000);

  const badVariant = await request.post("/en/api/quote", {
    data: { ...base, lines: [{ variantId: "00000000-0000-4000-8000-000000000000", quantity: 1 }] },
    headers: ORIGIN,
  });
  expect(badVariant.status()).toBe(422);
  expect((await badVariant.json()).error).toBe("unavailable");

  const badCoupon = await request.post("/en/api/quote", {
    data: { ...base, couponCode: "NOPE" },
    headers: ORIGIN,
  });
  expect(badCoupon.status()).toBe(422);
  expect((await badCoupon.json()).error).toBe("invalid");

  // A client-supplied price is ignored: the quote still uses the database price.
  const tampered = await request.post("/en/api/quote", {
    data: { ...base, lines: [{ variantId, quantity: 1, price: 1 }] },
    headers: ORIGIN,
  });
  expect((await tampered.json()).quote.subtotalPiasters).toBe(245000);

  const foreign = await request.post("/en/api/quote", {
    data: base,
    headers: { origin: "https://evil.example" },
  });
  expect([400, 403]).toContain(foreign.status());
});

test("cart: governorate and coupon change the server-priced totals", async ({ page }) => {
  await page.goto("/en/p/classic-sunglasses");
  await page.waitForSelector("html[data-hydrated]");
  await page.getByRole("button", { name: "Add to cart" }).first().click();
  await page.goto("/en/cart");
  await page.waitForSelector("html[data-hydrated]");
  await page.getByLabel("Governorate (to estimate shipping)").selectOption("cairo");
  await expect(page.locator("aside dl")).toContainText("EGP 70");
  await page.getByLabel("Discount code").fill("NOPE");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "not valid" })).toBeVisible();
  await page.getByLabel("Discount code").fill("welcome10");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Code applied" })).toBeVisible();
  await expect(page.locator("aside dl")).toContainText("− EGP 245");
  await expect(page.locator("aside dl")).toContainText("EGP 2,275"); // 2,450 - 245 + 70
});

test("COD checkout: order placed, stock held, guest can track it, strangers cannot", async ({
  page,
  browser,
}) => {
  await page.goto("/en/p/classic-sunglasses");
  await page.waitForSelector("html[data-hydrated]");
  await page.getByRole("button", { name: "Add to cart" }).first().click();
  await page.goto("/en/checkout");
  await page.waitForSelector("html[data-hydrated]");

  await page.getByLabel("First name *").fill("E2E Buyer");
  await page.getByLabel("Phone number *").fill("010 1234 5678");
  await page.getByLabel("Governorate *").selectOption("cairo");
  await page.getByLabel("City / area *").fill("Nasr City");
  await page.getByLabel("Street address *").fill("12 Test Street, Apt 4");
  await page.getByText("Cash on delivery", { exact: true }).click();
  await expect(page.locator("aside dl")).toContainText("EGP 2,520"); // 2,450 + 70
  await page.getByRole("button", { name: "Place order" }).click();

  await expect(page).toHaveURL(/\/en\/order\/SH-[A-Z0-9]{8}\?placed=1$/);
  await expect(page.getByText("We received your order")).toBeVisible();
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
  await expect(page.getByText("Cash on delivery", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /^Cart/ })).toBeVisible();
  expect(await page.getByRole("link", { name: /^Cart \(/ }).count()).toBe(0); // cart emptied after placing

  const ref = page.url().match(/SH-[A-Z0-9]{8}/)![0];
  await page.goto(`/en/order/${ref}`);
  await expect(page.getByRole("heading", { name: new RegExp(ref) })).toBeVisible();

  // A different browser has no access cookie: it gets the lookup form, and a wrong phone looks like "not found".
  const stranger = await browser.newContext();
  const p2 = await stranger.newPage();
  await p2.goto(`http://localhost:5173/en/order/${ref}`);
  await p2.waitForSelector("html[data-hydrated]");
  await expect(p2.getByRole("heading", { name: "Track your order" })).toBeVisible();
  await p2.getByLabel("Mobile number used on the order").fill("01099999999");
  await p2.getByRole("button", { name: "View order" }).click();
  await expect(p2.getByRole("alert")).toHaveText("We could not find an order with those details.");
  await p2.getByLabel("Order number").fill("SH-ZZZZZZZZ");
  await p2.getByRole("button", { name: "View order" }).click();
  await expect(p2.getByRole("alert")).toHaveText("We could not find an order with those details.");
  await p2.getByLabel("Order number").fill(ref);
  await p2.getByLabel("Mobile number used on the order").fill("+20 10 1234 5678");
  await p2.getByRole("button", { name: "View order" }).click();
  await expect(p2.getByRole("heading", { name: new RegExp(ref) })).toBeVisible();
  await stranger.close();
});

test("out of stock: checkout fails with a clear message and creates nothing", async ({ page }) => {
  const product = await seededProduct("round-sunglasses");
  await setStock(product.colors[0]!.variantId, 0);
  const before = await orderCount();
  await page.goto("/en/p/round-sunglasses");
  await page.waitForSelector("html[data-hydrated]");
  await page.getByRole("button", { name: "Add to cart" }).first().click();
  await page.goto("/en/checkout");
  await page.waitForSelector("html[data-hydrated]");
  await page.getByLabel("First name *").fill("E2E OutOfStock");
  await page.getByLabel("Phone number *").fill("01112345678");
  await page.getByLabel("Governorate *").selectOption("giza");
  await page.getByLabel("City / area *").fill("Dokki");
  await page.getByLabel("Street address *").fill("5 Nile Street");
  await page.getByText("Cash on delivery", { exact: true }).click();
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "out of stock" })).toBeVisible();
  expect(await orderCount()).toBe(before);
  await setStock(product.colors[0]!.variantId, 20);
});

test("double submit of the same checkout key yields one order", async ({ request }) => {
  const product = await seededProduct("aviator-sunglasses");
  const variantId = product.colors[0]!.variantId;
  const key = `e2e-double-submit-${Date.now()}-abcdef`;
  const form = {
    idempotencyKey: key,
    lines: JSON.stringify([{ variantId, quantity: 1 }]),
    name: "E2E Double",
    phone: "01212345678",
    email: "",
    deliveryMethod: "delivery",
    governorate: "cairo",
    city: "Zamalek",
    address: "1 Island Road",
    paymentMethod: "cod",
    coupon: "",
    notes: "",
  };
  const post = () => request.post("/en/checkout", { form, headers: ORIGIN, maxRedirects: 0 });
  const [a, b, c] = await Promise.all([post(), post(), post()]);
  const locations = [a, b, c].map((r) => r.headers()["location"]);
  expect([a, b, c].every((r) => r.status() === 302 || r.status() === 303)).toBe(true);
  expect(new Set(locations.map((l) => l?.split("?")[0])).size).toBe(1);
  expect(await orderCount()).toBeGreaterThan(0);
});

test("pickup order goes to a branch that offers pickup", async ({ page }) => {
  expect((await demoBranchIds()).length).toBeGreaterThan(0);
  await page.goto("/en/p/silver-aviator");
  await page.waitForSelector("html[data-hydrated]");
  await page.getByRole("button", { name: "Add to cart" }).first().click();
  await page.goto("/en/checkout");
  await page.waitForSelector("html[data-hydrated]");
  await page.getByLabel("First name *").fill("E2E Pickup");
  await page.getByLabel("Phone number *").fill("01512345678");
  await page.getByText("Pick up from a branch", { exact: true }).click();
  await page.getByLabel("Pickup branch *").selectOption({ index: 0 });
  await page.getByText("Cash on delivery", { exact: true }).click();
  await expect(page.locator("aside dl")).toContainText("EGP 2,300"); // no shipping for pickup
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page).toHaveURL(/\/en\/order\/SH-[A-Z0-9]{8}\?placed=1$/);
});

test("admin: sees the orders, moves one through fulfilment, records COD cash; inventory adjusts with a reason", async ({
  page,
}) => {
  await loginAsStaff(page, admin);
  await page.goto("/en/admin/orders");
  const first = page.locator("main ul li a").first();
  await expect(first).toBeVisible();
  await first.click();
  await expect(page.getByRole("heading", { name: /^Orders SH-/ })).toBeVisible();

  const act = async (name: string) => {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Done.");
  };
  // A COD order cannot be collected before hand-over.
  await expect(page.getByRole("button", { name: "Record cash collected" })).toHaveCount(0);
  const pickup = await page.getByText("Branch pickup", { exact: true }).isVisible();
  await act("Packing");
  if (pickup) {
    await act("Ready for pickup");
    await act("Picked up");
  } else {
    await act("Shipped");
    await act("Delivered");
  }
  await act("Record cash collected");
  await expect(
    page.getByText(pickup ? /Completed · Paid · Picked up/ : /Completed · Paid · Delivered/),
  ).toBeVisible();

  await page.goto("/en/admin/inventory");
  const row = page.locator("main li").first();
  await row.getByLabel(/Change/).fill("-9999");
  await row.getByLabel("Reason").fill("count correction");
  await row.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByRole("alert")).toContainText("cannot drop below");
  await row.getByLabel(/Change/).fill("5");
  await row.getByLabel("Reason").fill("supplier delivery");
  await row.locator("select").selectOption("receipt");
  await row.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
});
