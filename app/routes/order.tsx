import { useEffect } from "react";
import { data, Form, redirect, useActionData, useLocation, useRevalidator } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/order";
import { colorName } from "~/demo/data";
import { useT } from "~/i18n/context";
import { formatEGP } from "~/lib/format";
import { useCart } from "~/lib/cart";
import { Field, FormError, SubmitButton } from "~/components/form";
import { btnOutline, btnPrimary, container } from "~/components/ui";
import { cancelOrder, getOrderByRef, getOrderForCustomer, InvalidOrder } from "../../server/orders/service";
import { orderAccessToken, orderCookieName, verifyOrderAccess } from "../../server/orders/access";
import { PaymentStartError, startOnlinePayment } from "../../server/payments/service";
import { hit, TooManyRequestsError } from "../../server/security/throttle";
import { assertSameOrigin, clientIp, getScope, readCookie, sessionCookie } from "../../server/http/session";

export function meta() {
  return [{ title: "SHROUK" }, { name: "robots", content: "noindex,nofollow" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const scope = getScope(context);
  const placed = new URL(request.url).searchParams.get("placed") === "1";
  if (!params.ref) return { order: null, placed: false, canPay: false, payerr: false };
  const ref = params.ref.toUpperCase();
  if (!(await verifyOrderAccess(scope.authConfig, ref, readCookie(request, orderCookieName(ref)))))
    return { order: null, placed: false, canPay: false, payerr: false, ref };
  const order = await getOrderByRef(scope.db, ref);
  if (!order) throw data(null, { status: 404 });
  const canPay =
    scope.onlinePaymentsEnabled &&
    order.paymentMethod === "online" &&
    order.status === "pending_payment" &&
    (order.paymentStatus === "unpaid" || order.paymentStatus === "failed") &&
    (!order.expiresAt || order.expiresAt.getTime() > Date.now());
  return { order, placed, canPay, payerr: new URL(request.url).searchParams.get("payerr") === "1" };
}

const lookup = z.object({
  ref: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^SH-[A-Z0-9]{8}$/),
  phone: z.string().trim().max(30),
});

export async function action({ request, context, params }: Route.ActionArgs) {
  assertSameOrigin(request);
  const scope = getScope(context);
  const form = await request.formData();
  const intent = form.get("intent")?.toString();

  if (intent === "pay" && params.ref && scope.paymob) {
    const ref = params.ref.toUpperCase();
    if (!(await verifyOrderAccess(scope.authConfig, ref, readCookie(request, orderCookieName(ref)))))
      throw data(null, { status: 403 });
    try {
      await hit(scope.db, `pay:ip:${clientIp(request)}`, 20, 600);
      const { redirectUrl } = await startOnlinePayment(scope.db, scope.paymob, ref, {
        returnUrl: `${scope.env.SITE_URL}/${params.lang}/checkout/result/${ref}`,
        notificationUrl: `${scope.env.SITE_URL}/webhooks/paymob`,
      });
      return redirect(redirectUrl);
    } catch (e) {
      if (e instanceof TooManyRequestsError) return redirect(`/${params.lang}/order/${ref}?payerr=1`);
      if (e instanceof PaymentStartError) return redirect(`/${params.lang}/order/${ref}?payerr=1`);
      throw e;
    }
  }

  if (intent === "cancel" && params.ref) {
    const ref = params.ref.toUpperCase();
    if (!(await verifyOrderAccess(scope.authConfig, ref, readCookie(request, orderCookieName(ref)))))
      throw data(null, { status: 403 });
    try {
      await cancelOrder(scope.db, ref, { type: "customer" }, "cancelled by customer");
    } catch (e) {
      if (!(e instanceof InvalidOrder)) throw e;
    }
    return redirect(`/${params.lang}/order/${ref}`);
  }

  try {
    await hit(scope.db, `order-lookup:ip:${clientIp(request)}`, 15, 600);
  } catch (e) {
    if (e instanceof TooManyRequestsError) return { error: "tooMany" as const };
    throw e;
  }
  const parsed = lookup.safeParse(Object.fromEntries(form));
  // Same answer for "no such order" and "wrong phone": the lookup cannot be used to probe which references exist.
  const found = parsed.success
    ? await getOrderForCustomer(scope.db, parsed.data.ref, parsed.data.phone)
    : null;
  if (!found) return { error: "notFound" as const };
  const token = await orderAccessToken(scope.authConfig, found.ref);
  return redirect(`/${params.lang}/order/${found.ref}`, {
    headers: { "Set-Cookie": sessionCookie(scope, orderCookieName(found.ref), token, 30 * 24 * 3600, "Lax") },
  });
}

export default function OrderPage({ loaderData }: Route.ComponentProps) {
  const { p, lang } = useT();
  const result = useActionData<typeof action>();
  const { clear } = useCart();
  const { order, placed, canPay, payerr } = loaderData;
  const { pathname } = useLocation();
  const revalidator = useRevalidator();
  const isResult = pathname.includes("/checkout/result/");
  const waiting =
    isResult && !!order && order.status === "pending_payment" && order.paymentStatus === "unpaid";

  useEffect(() => {
    if (placed) clear();
  }, [placed, clear]);

  // Back from the provider: the redirect proves nothing, so wait for the verified webhook by re-reading the order.
  useEffect(() => {
    if (!waiting) return;
    let tries = 0;
    const id = window.setInterval(() => {
      if (++tries > 20) window.clearInterval(id);
      else revalidator.revalidate();
    }, 4000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting]);

  if (!order) {
    return (
      <div className={`${container} max-w-md py-12`}>
        <h1 className="text-2xl font-bold">{p.order.lookupTitle}</h1>
        <Form method="post" className="mt-6 space-y-4">
          <FormError>
            {result?.error === "tooMany"
              ? p.checkout.errors.tooMany
              : result?.error
                ? p.order.notFound
                : null}
          </FormError>
          <Field
            label={p.order.ref}
            name="ref"
            dir="ltr"
            defaultValue={"ref" in loaderData ? (loaderData.ref as string) : ""}
          />
          <Field label={p.order.phone} name="phone" type="tel" dir="ltr" autoComplete="tel" />
          <SubmitButton className={`${btnPrimary} w-full`}>{p.order.lookup}</SubmitButton>
        </Form>
      </div>
    );
  }

  const canCancel = order.status === "pending_payment" && order.paymentStatus !== "paid";
  return (
    <div className={`${container} max-w-3xl py-10`}>
      {placed ? (
        <div role="status" className="mb-6 rounded-card border border-emerald-500/40 bg-emerald-500/10 p-4">
          <h2 className="text-lg font-bold">{p.order.placedTitle}</h2>
          <p className="text-sm">{p.order.placedBody}</p>
        </div>
      ) : null}
      <h1 className="text-2xl font-bold">
        {p.order.title}{" "}
        <span dir="ltr" className="font-mono">
          {order.ref}
        </span>
      </h1>
      <ul className="mt-4 grid gap-2 rounded-card bg-panel p-4 text-sm font-semibold sm:grid-cols-3">
        <li>{p.order.status[order.status]}</li>
        <li>{p.order.payment[order.paymentStatus]}</li>
        <li>{p.order.fulfillment[order.fulfillmentStatus]}</li>
      </ul>
      {waiting ? (
        <p role="status" className="mt-3 rounded-input border border-sand bg-surface p-3 text-sm">
          {p.order.verifying}
        </p>
      ) : null}
      {payerr || order.paymentStatus === "failed" ? (
        <p role="alert" className="mt-3 rounded-input border border-red-500/40 bg-red-500/10 p-3 text-sm">
          {payerr ? p.order.payFailed : p.order.paymentFailedNote}
        </p>
      ) : null}
      {order.status === "pending_payment" && !canPay && !waiting ? (
        <p className="mt-3 rounded-input border border-sand bg-surface p-3 text-sm text-muted">
          {p.order.onlinePending}
          {order.expiresAt
            ? ` ${p.order.holdUntil} ${new Date(order.expiresAt).toLocaleString(lang === "ar" ? "ar-EG" : "en-GB", { timeZone: "Africa/Cairo" })}`
            : ""}
        </p>
      ) : null}

      <h2 className="mt-8 text-lg font-bold">{p.order.items}</h2>
      <ul className="mt-3 grid gap-3">
        {order.lines.map((l) => (
          <li
            key={l.sku}
            className="flex items-start justify-between gap-4 rounded-card border border-sand bg-surface p-3 text-sm"
          >
            <span>
              <span className="block font-semibold">{lang === "ar" ? l.titleAr : l.titleEn}</span>
              <span className="text-muted">
                {colorName(l.colorKey, lang)} × {l.quantity}
              </span>
            </span>
            <span className="font-semibold">{formatEGP(l.lineTotalPiasters, lang)}</span>
          </li>
        ))}
      </ul>
      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted">{p.cart.subtotal}</dt>
          <dd>{formatEGP(order.subtotalPiasters, lang)}</dd>
        </div>
        {order.discountPiasters > 0 ? (
          <div className="flex justify-between">
            <dt className="text-muted">
              {p.cart.discountLabel} ({order.couponCode})
            </dt>
            <dd>− {formatEGP(order.discountPiasters, lang)}</dd>
          </div>
        ) : null}
        <div className="flex justify-between">
          <dt className="text-muted">{p.cart.shipping}</dt>
          <dd>{formatEGP(order.shippingPiasters, lang)}</dd>
        </div>
        <div className="flex justify-between border-t border-sand pt-2 text-base font-bold">
          <dt>{p.cart.grandTotal}</dt>
          <dd>{formatEGP(order.totalPiasters, lang)}</dd>
        </div>
      </dl>
      {canPay ? (
        <Form method="post" className="mt-6">
          <input type="hidden" name="intent" value="pay" />
          <button type="submit" className={btnPrimary}>
            {p.order.payNow}
          </button>
        </Form>
      ) : null}
      {canCancel ? (
        <Form method="post" className="mt-6">
          <input type="hidden" name="intent" value="cancel" />
          <button type="submit" className={btnOutline}>
            {p.order.cancel}
          </button>
        </Form>
      ) : null}
    </div>
  );
}
