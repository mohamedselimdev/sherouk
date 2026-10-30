import { useEffect, useState } from "react";
import { Form, Link, redirect, useActionData, useNavigation } from "react-router";
import { and, asc, eq, isNull } from "drizzle-orm";
import { ZodError } from "zod";
import { Banknote, Check, CreditCard, Lock, Store, Truck } from "lucide-react";
import type { Route } from "./+types/checkout";
import { colorName } from "~/demo/data";
import { DEFAULT_LOCALE, isLocale } from "~/i18n/config";
import { useT } from "~/i18n/context";
import { formatEGP } from "~/lib/format";
import { useCart } from "~/lib/cart";
import { useQuote } from "~/lib/quote";
import { OrderSummary } from "~/components/order-summary";
import { inputCls } from "~/components/form";
import { btnPrimary, container, ProductImage } from "~/components/ui";
import { branchTranslations, branches } from "../../db/schema";
import { GOVERNORATES } from "../../server/fulfillment/governorates";
import { OutOfStockError } from "../../server/inventory/service";
import { createOrder, InvalidOrder } from "../../server/orders/service";
import { PaymentStartError, startOnlinePayment } from "../../server/payments/service";
import { orderAccessToken, orderCookieName } from "../../server/orders/access";
import { hit, TooManyRequestsError } from "../../server/security/throttle";
import { assertSameOrigin, clientIp, getScope, peekCustomer, sessionCookie } from "../../server/http/session";

export function meta({ params }: Route.MetaArgs) {
  const lang = isLocale(params.lang) ? params.lang : DEFAULT_LOCALE;
  return [
    { title: `${lang === "ar" ? "إتمام الطلب" : "Checkout"} | SHROUK` },
    { name: "robots", content: "noindex" },
  ];
}

export async function loader({ context, params }: Route.LoaderArgs) {
  const scope = getScope(context);
  const locale = isLocale(params.lang) ? params.lang : DEFAULT_LOCALE;
  const pickup = await scope.db
    .select({ id: branches.id, name: branchTranslations.name })
    .from(branches)
    .innerJoin(
      branchTranslations,
      and(eq(branchTranslations.branchId, branches.id), eq(branchTranslations.locale, locale)),
    )
    .where(and(eq(branches.pickupEnabled, true), isNull(branches.archivedAt)))
    .orderBy(asc(branches.slug));
  return { pickup, codEnabled: scope.allowCod, onlineEnabled: scope.onlinePaymentsEnabled };
}

type ErrorKey = keyof ReturnType<typeof useT>["p"]["checkout"]["errors"];

function text(f: FormData, k: string): string {
  return (f.get(k)?.toString() ?? "").trim();
}

export async function action({ request, context, params }: Route.ActionArgs) {
  assertSameOrigin(request);
  const { session, scope } = await peekCustomer(request, context);
  const f = await request.formData();
  let lines: unknown;
  try {
    lines = JSON.parse(text(f, "lines"));
  } catch {
    return { error: "invalid" as ErrorKey };
  }
  const method = text(f, "deliveryMethod");
  try {
    await hit(scope.db, `checkout:ip:${clientIp(request)}`, 20, 600);
    const created = await createOrder(
      scope.db,
      {
        idempotencyKey: text(f, "idempotencyKey"),
        lines,
        contact: { name: text(f, "name"), phone: text(f, "phone"), email: text(f, "email") || null },
        delivery:
          method === "pickup"
            ? { method: "pickup", branchId: text(f, "branchId") }
            : {
                method: "delivery",
                governorate: text(f, "governorate"),
                city: text(f, "city"),
                address: text(f, "address"),
              },
        couponCode: text(f, "coupon") || null,
        paymentMethod: text(f, "paymentMethod"),
        notes: text(f, "notes") || null,
        locale: isLocale(params.lang) ? params.lang : DEFAULT_LOCALE,
      },
      {
        allowCod: scope.allowCod,
        allowOnline: scope.onlinePaymentsEnabled,
        customerId: session?.customer.id ?? null,
      },
    );
    const token = await orderAccessToken(scope.authConfig, created.ref);
    const cookie = sessionCookie(scope, orderCookieName(created.ref), token, 30 * 24 * 3600, "Lax");
    const orderUrl = `/${params.lang}/order/${created.ref}?placed=1`;
    if (!created.replay && created.status === "pending_payment" && scope.paymob) {
      try {
        const { redirectUrl } = await startOnlinePayment(scope.db, scope.paymob, created.ref, {
          returnUrl: `${scope.env.SITE_URL}/${params.lang}/checkout/result/${created.ref}`,
          notificationUrl: `${scope.env.SITE_URL}/webhooks/paymob`,
        });
        return redirect(redirectUrl, { headers: { "Set-Cookie": cookie } });
      } catch (e) {
        if (!(e instanceof PaymentStartError)) throw e;
        console.error(
          JSON.stringify({
            level: "error",
            event: "payment_start_failed",
            order: created.ref,
            reason: e.message,
            correlationId: scope.correlationId,
          }),
        );
        // The order and its stock hold exist; the customer can retry from the order page.
        return redirect(`${orderUrl}&payerr=1`, { headers: { "Set-Cookie": cookie } });
      }
    }
    return redirect(orderUrl, { headers: { "Set-Cookie": cookie } });
  } catch (e) {
    if (e instanceof TooManyRequestsError) return { error: "tooMany" as ErrorKey };
    if (e instanceof OutOfStockError) return { error: "out_of_stock" as ErrorKey };
    if (e instanceof ZodError) return { error: "invalid" as ErrorKey };
    if (e instanceof InvalidOrder) {
      const key: ErrorKey =
        e.code === "empty"
          ? "empty"
          : e.code === "unavailable"
            ? "unavailable"
            : e.code === "shipping"
              ? "shipping"
              : e.code === "pickup"
                ? "pickup"
                : e.code === "coupon"
                  ? "coupon"
                  : e.code === "quantity"
                    ? "quantity"
                    : e.code === "payment_method"
                      ? "payment_method"
                      : "invalid";
      return { error: key };
    }
    throw e;
  }
}

function Stepper() {
  const { p } = useT();
  return (
    <ol className="flex items-start justify-between gap-2" aria-label={p.checkout.title}>
      {p.checkout.steps.map((label, i) => (
        <li
          key={label}
          aria-current={i === 0 ? "step" : undefined}
          className="flex flex-1 flex-col items-center gap-1 text-center text-xs sm:text-sm"
        >
          <span
            className={`grid size-9 place-items-center rounded-full border-2 font-bold ${i === 0 ? "border-cta bg-cta text-cta-fg" : "border-sand text-muted"}`}
          >
            {i + 1}
          </span>
          <span className={i === 0 ? "font-semibold text-cta" : "text-muted"}>{label}</span>
        </li>
      ))}
    </ol>
  );
}

export default function Checkout({ loaderData }: Route.ComponentProps) {
  const { p, lang } = useT();
  const { lines, prefs, setPrefs } = useCart();
  const result = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  const [delivery, setDelivery] = useState<"delivery" | "pickup">("delivery");
  const [payment, setPayment] = useState<"cod" | "online" | "">(
    loaderData.onlineEnabled ? "online" : loaderData.codEnabled ? "cod" : "",
  );
  const [key, setKey] = useState("");
  useEffect(() => {
    // One key per checkout page view: a double click or a retry after a network error cannot create a second order.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setKey(crypto.randomUUID());
  }, []);
  const quote = useQuote(lang, lines, { governorate: prefs.governorate, coupon: prefs.coupon, delivery });

  if (lines.length === 0) {
    return (
      <div className={`${container} py-16 text-center`}>
        <h1 className="text-2xl font-bold">{p.checkout.emptyCart}</h1>
        <Link to={`/${lang}/shop`} className={`${btnPrimary} mt-6`}>
          {p.checkout.backToShop}
        </Link>
      </div>
    );
  }

  const field = `mt-1 w-full rounded-input border border-sand bg-surface px-3 py-3 text-sm`;
  const canPlace =
    ((loaderData.codEnabled && payment === "cod") || (loaderData.onlineEnabled && payment === "online")) &&
    !!key &&
    !busy;
  const priced = new Map(quote.quote?.lines.map((l) => [l.variantId, l.unitPricePiasters]));

  return (
    <div className={`${container} py-8`}>
      <h1 className="sr-only">{p.checkout.title}</h1>
      <Stepper />
      <p className="mt-3 text-sm text-muted">{p.checkout.guestNote}</p>
      {result?.error ? (
        <p
          role="alert"
          className="mt-4 rounded-input border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300"
        >
          {p.checkout.errors[result.error]}
        </p>
      ) : null}

      <Form
        method="post"
        className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_22rem]"
      >
        <input type="hidden" name="idempotencyKey" value={key} />
        <input
          type="hidden"
          name="lines"
          value={JSON.stringify(lines.map((l) => ({ variantId: l.variantId, quantity: l.qty })))}
        />
        <input type="hidden" name="coupon" value={prefs.coupon} />
        <input type="hidden" name="deliveryMethod" value={delivery} />

        <section className="space-y-5 rounded-card bg-panel p-5" aria-labelledby="cust-h">
          <div>
            <h2 id="cust-h" className="text-lg font-bold">
              {p.checkout.customer}
            </h2>
            <p className="text-sm text-muted">{p.checkout.customerHint}</p>
          </div>
          <label className="block text-sm">
            {p.checkout.firstName} *
            <input name="name" autoComplete="name" required minLength={2} maxLength={100} className={field} />
          </label>
          <label className="block text-sm">
            {p.checkout.phone} *
            <div className="mt-1 flex gap-2" dir="ltr">
              <span className="grid place-items-center rounded-input border border-sand bg-surface px-3 text-sm">
                +20
              </span>
              <input
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                placeholder="10 1234 5678"
                required
                className={`${field} !mt-0 flex-1`}
              />
            </div>
          </label>
          <label className="block text-sm">
            {p.checkout.email}
            <input name="email" type="email" autoComplete="email" className={field} dir="ltr" />
          </label>

          <fieldset>
            <legend className="mb-2 text-lg font-bold">{p.checkout.delivery}</legend>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ["pickup", Store, p.checkout.pickup, p.checkout.pickupBody],
                  ["delivery", Truck, p.checkout.home, p.checkout.homeBody],
                ] as const
              ).map(([k, Icon, title, body]) => (
                <label key={k} className="cursor-pointer">
                  <input
                    type="radio"
                    name="delivery"
                    value={k}
                    checked={delivery === k}
                    onChange={() => setDelivery(k)}
                    className="peer sr-only"
                  />
                  <span className="flex h-full flex-col items-center gap-1 rounded-card border-2 border-sand bg-surface p-3 text-center peer-checked:border-cta peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-cta">
                    <Icon className="size-7 text-brown" aria-hidden />
                    <span className="text-sm font-semibold">{title}</span>
                    <span className="text-xs text-muted">{body}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {delivery === "delivery" ? (
            <fieldset className="space-y-3">
              <legend className="mb-1 text-lg font-bold">{p.checkout.address}</legend>
              <label className="block text-sm">
                {p.checkout.governorate} *
                <select
                  name="governorate"
                  required
                  value={prefs.governorate}
                  onChange={(e) => setPrefs({ governorate: e.target.value })}
                  className={inputCls}
                >
                  <option value="">{p.cart.chooseGovernorate}</option>
                  {GOVERNORATES.map((g) => (
                    <option key={g.key} value={g.key}>
                      {g[lang]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                {p.checkout.city} *
                <input name="city" autoComplete="address-level2" required maxLength={80} className={field} />
              </label>
              <label className="block text-sm">
                {p.checkout.addressLine} *
                <input
                  name="address"
                  autoComplete="street-address"
                  required
                  minLength={5}
                  maxLength={300}
                  className={field}
                />
              </label>
            </fieldset>
          ) : (
            <label className="block text-sm">
              {p.checkout.pickupBranch} *
              {loaderData.pickup.length === 0 ? (
                <span className="mt-1 block text-muted">{p.checkout.noPickup}</span>
              ) : (
                <select name="branchId" required className={inputCls}>
                  {loaderData.pickup.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              )}
            </label>
          )}
          <label className="block text-sm">
            {p.checkout.notes}
            <textarea name="notes" rows={3} maxLength={500} className={field} />
          </label>
        </section>

        <section className="space-y-4 rounded-card bg-panel p-5" aria-labelledby="pay-h">
          <h2 id="pay-h" className="text-lg font-bold">
            {p.checkout.payment}
          </h2>
          {loaderData.onlineEnabled ? (
            <label className="cursor-pointer">
              <input
                type="radio"
                name="paymentMethod"
                value="online"
                checked={payment === "online"}
                onChange={() => setPayment("online")}
                className="peer sr-only"
              />
              <span className="flex items-center gap-3 rounded-card border-2 border-sand bg-surface p-3 peer-checked:border-cta peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-cta">
                <CreditCard className="size-7 text-brown" aria-hidden />
                <span>
                  <span className="block text-sm font-semibold">{p.checkout.cardLabel}</span>
                  <span className="block text-xs text-muted">{p.checkout.cardBody}</span>
                </span>
              </span>
            </label>
          ) : null}
          {loaderData.codEnabled ? (
            <label className="cursor-pointer">
              <input
                type="radio"
                name="paymentMethod"
                value="cod"
                checked={payment === "cod"}
                onChange={() => setPayment("cod")}
                className="peer sr-only"
              />
              <span className="flex items-center gap-3 rounded-card border-2 border-sand bg-surface p-3 peer-checked:border-cta peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-cta">
                <Banknote className="size-7 text-brown" aria-hidden />
                <span>
                  <span className="block text-sm font-semibold">{p.checkout.codLabel}</span>
                  <span className="block text-xs text-muted">{p.checkout.codBody}</span>
                </span>
              </span>
            </label>
          ) : null}
          {!loaderData.codEnabled && !loaderData.onlineEnabled ? (
            <>
              <p className="text-sm text-muted">{p.checkout.paymentHint}</p>
              <div
                className="rounded-card border border-dashed border-sand bg-surface p-4 text-sm"
                role="status"
              >
                {p.checkout.paymentPending}
              </div>
            </>
          ) : null}
          <p className="flex items-start gap-2 rounded-card bg-surface p-3 text-xs text-muted">
            <Check className="mt-0.5 size-4 shrink-0 text-cta" aria-hidden />
            {lang === "ar"
              ? "بيانات البطاقة لا تُدخل في موقعنا؛ تتم على صفحة الدفع المؤمّنة لدى مزوّد الدفع."
              : "Card details are never entered on our site; they are taken on the payment provider's secure page."}
          </p>
        </section>

        <div className="space-y-4">
          <section className="rounded-card bg-panel p-5" aria-labelledby="items-h">
            <h2 id="items-h" className="text-lg font-bold">
              {p.checkout.summary}
            </h2>
            <ul className="mt-3 grid gap-3">
              {lines.map((l) => (
                <li key={l.variantId} className="flex gap-3">
                  <ProductImage src={l.image} className="w-20 shrink-0" />
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-semibold">{l.name[lang]}</p>
                    <p className="text-xs text-muted">
                      {colorName(l.colorKey, lang)} × {l.qty}
                    </p>
                    <p className="font-semibold">
                      {formatEGP((priced.get(l.variantId) ?? l.price) * l.qty, lang)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
          <OrderSummary
            quote={quote}
            showCoupon={false}
            cta={
              <>
                <button
                  type="submit"
                  disabled={!canPlace}
                  className={btnPrimary}
                  aria-describedby={canPlace ? undefined : "order-off"}
                >
                  <Lock className="size-4" aria-hidden />
                  {busy ? p.checkout.placing : p.checkout.placeOrder}
                </button>
                {!loaderData.codEnabled && !loaderData.onlineEnabled ? (
                  <p id="order-off" className="text-xs text-muted">
                    {p.checkout.placeOrderOff}
                  </p>
                ) : null}
              </>
            }
          />
        </div>
      </Form>
    </div>
  );
}
