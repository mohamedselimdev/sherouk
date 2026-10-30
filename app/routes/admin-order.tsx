import { data, Form, Link, useActionData, useOutletContext } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/admin-order";
import type { AdminOutletContext } from "~/layouts/admin";
import { colorName } from "~/demo/data";
import { useT } from "~/i18n/context";
import { formatEGP } from "~/lib/format";
import { FormError, FormOk, inputCls } from "~/components/form";
import { btnOutline, btnPrimary } from "~/components/ui";
import { ForbiddenError } from "../../server/auth/rbac";
import { NotFoundError } from "../../server/catalog/admin";
import {
  advanceFulfillment,
  cancelOrder,
  getOrderForStaff,
  InvalidOrder,
  recordCodCollection,
} from "../../server/orders/service";
import {
  FULFILLMENT_TRANSITIONS,
  fulfillmentAllowedFor,
  InvalidTransition,
  type FulfillmentStatus,
} from "../../server/orders/state";
import {
  approveRefund,
  getPaymentInfo,
  rejectRefund,
  RefundError,
  requestRefund,
} from "../../server/payments/service";
import { requireStaff, requireStaffAction } from "../../server/http/session";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { principal, scope } = await requireStaff(request, context, {
    lang: params.lang,
    permission: "orders:read",
    anyScope: true,
  });
  try {
    const base = await getOrderForStaff(scope.db, principal, params.ref);
    return { ...base, payments: await getPaymentInfo(scope.db, base.order.id) };
  } catch (e) {
    if (e instanceof NotFoundError) throw data(null, { status: 404 });
    if (e instanceof ForbiddenError) throw data(null, { status: 404 }); // other branches' orders look like they do not exist
    throw e;
  }
}

const STEPS = Object.keys(FULFILLMENT_TRANSITIONS) as FulfillmentStatus[];

export async function action({ request, context, params }: Route.ActionArgs) {
  const { auth, form } = await requireStaffAction(request, context, { lang: params.lang, anyScope: true });
  const { scope, principal } = auth;
  const intent = form.get("intent")?.toString();
  try {
    if (intent === "advance") {
      const to = STEPS.find((s) => s === form.get("to")?.toString());
      if (!to) return { error: "errInvalid" as const };
      await advanceFulfillment(scope.db, principal, params.ref, to);
    } else if (intent === "cancel") {
      const reason = z.string().trim().min(3).max(200).safeParse(form.get("reason"));
      if (!reason.success) return { error: "errInvalid" as const };
      await cancelOrder(scope.db, params.ref, { type: "staff", principal }, reason.data);
    } else if (intent === "refund-request") {
      const amount = form.get("amount")?.toString().trim() ?? "";
      if (!/^\d{1,7}(\.\d{1,2})?$/.test(amount)) return { error: "errRefund" as const };
      await requestRefund(
        scope.db,
        principal,
        params.ref,
        Math.round(Number(amount) * 100),
        form.get("reason")?.toString() ?? "",
      );
    } else if (intent === "refund-approve") {
      const r = await approveRefund(
        scope.db,
        principal,
        form.get("refundId")?.toString() ?? "",
        scope.paymob,
      );
      if (r.status === "failed") return { error: "errRefund" as const };
    } else if (intent === "refund-reject") {
      await rejectRefund(scope.db, principal, form.get("refundId")?.toString() ?? "", "rejected by finance");
    } else if (intent === "cod") {
      await recordCodCollection(scope.db, principal, params.ref);
    } else return { error: "errInvalid" as const };
    return { ok: true as const };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "errForbidden" as const };
    if (e instanceof RefundError) return { error: "errRefund" as const };
    if (e instanceof InvalidTransition || e instanceof InvalidOrder) return { error: "errState" as const };
    if (e instanceof NotFoundError) throw data(null, { status: 404 });
    throw e;
  }
}

export default function AdminOrder({ loaderData }: Route.ComponentProps) {
  const { a, p, lang } = useT();
  const { csrf, caps } = useOutletContext<AdminOutletContext>();
  const result = useActionData<typeof action>();
  const { order: o, lines, events, payments } = loaderData;
  const open = o.status === "confirmed" || o.status === "processing";
  const canCollect =
    o.paymentMethod === "cod" &&
    o.paymentStatus === "awaiting_collection" &&
    ["delivered", "picked_up"].includes(o.fulfillmentStatus);
  const next = FULFILLMENT_TRANSITIONS[o.fulfillmentStatus].filter((s) =>
    fulfillmentAllowedFor(o.deliveryMethod, s),
  );
  const hidden = (intent: string) => (
    <>
      <input type="hidden" name="_csrf" value={csrf} />
      <input type="hidden" name="intent" value={intent} />
    </>
  );
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">
          {a.orders.title}{" "}
          <span dir="ltr" className="font-mono">
            {o.ref}
          </span>
        </h1>
        <Link to={`/${lang}/admin/orders`} className={btnOutline}>
          {a.orders.title}
        </Link>
      </div>
      <FormError>{result?.error ? a.orders[result.error] : null}</FormError>
      <FormOk>{result?.ok ? a.orders.done : null}</FormOk>
      {o.exception || o.needsRefund ? (
        <p role="alert" className="rounded-input border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm">
          {a.orders.exception}: {o.exception ?? a.orders.needsRefund}
        </p>
      ) : null}

      <section className="grid gap-4 rounded-card border border-sand bg-surface p-5 text-sm sm:grid-cols-2">
        <p>
          {p.order.status[o.status]} · {p.order.payment[o.paymentStatus]} ·{" "}
          {p.order.fulfillment[o.fulfillmentStatus]}
        </p>
        <p>{o.deliveryMethod === "delivery" ? a.orders.delivery : a.orders.pickup}</p>
        <p>
          {a.orders.customer}: {o.contactName}
        </p>
        <p dir="ltr" className="text-start">
          {a.orders.phone}: {o.contactPhone}
        </p>
        {o.deliveryMethod === "delivery" ? (
          <p className="sm:col-span-2">
            {a.orders.address}: {o.shipGovernorate} / {o.shipCity} / {o.shipAddress}
          </p>
        ) : null}
        {o.notes ? <p className="sm:col-span-2">{o.notes}</p> : null}
      </section>

      <section aria-labelledby="lines-h">
        <h2 id="lines-h" className="mb-2 text-lg font-bold">
          {a.orders.items}
        </h2>
        <ul className="grid gap-2">
          {lines.map((l) => (
            <li
              key={l.id}
              className="flex justify-between gap-3 rounded-input border border-sand bg-surface p-3 text-sm"
            >
              <span>
                {lang === "ar" ? l.titleAr : l.titleEn}{" "}
                <span className="text-muted">
                  ({l.sku}, {colorName(l.colorKey, lang)} × {l.quantity})
                </span>
              </span>
              <span>{formatEGP(l.lineTotalPiasters, lang)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-end font-bold">{formatEGP(o.totalPiasters, lang)}</p>
      </section>

      {caps.ordersManage && (open || canCollect) ? (
        <section className="flex flex-wrap items-end gap-3 rounded-card border border-sand bg-surface p-5">
          {(open ? next : []).map((s) => (
            <Form method="post" key={s}>
              {hidden("advance")}
              <input type="hidden" name="to" value={s} />
              <button type="submit" className={btnPrimary}>
                {p.order.fulfillment[s]}
              </button>
            </Form>
          ))}
          {canCollect ? (
            <Form method="post">
              {hidden("cod")}
              <button type="submit" className={btnPrimary}>
                {a.orders.codCollect}
              </button>
            </Form>
          ) : null}
          {open &&
          !["shipped", "ready_for_pickup", "delivered", "picked_up"].includes(o.fulfillmentStatus) ? (
            <Form method="post" className="flex items-end gap-2">
              {hidden("cancel")}
              <label className="text-sm">
                {a.orders.reason}
                <input name="reason" required minLength={3} maxLength={200} className={inputCls} />
              </label>
              <button type="submit" className={btnOutline}>
                {a.orders.cancel}
              </button>
            </Form>
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby="pay-h" className="space-y-3">
        <h2 id="pay-h" className="text-lg font-bold">
          {a.orders.payments}
        </h2>
        <p className="text-sm text-muted">
          {a.orders.ledger}: {formatEGP(payments.ledgerTotal, lang)}
        </p>
        {payments.attempts.length ? (
          <ul className="grid gap-1 text-sm">
            {payments.attempts.map((at) => (
              <li
                key={at.id}
                className="flex justify-between gap-3 rounded-input border border-sand bg-surface p-2"
              >
                <span dir="ltr" className="font-mono">
                  {at.specialReference}
                </span>
                <span>
                  {a.orders.attemptStatus[at.status]} · {formatEGP(at.amountPiasters, lang)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {payments.refunds.length ? (
          <ul className="grid gap-2 text-sm">
            {payments.refunds.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-input border border-sand bg-surface p-2"
              >
                <span>
                  {formatEGP(r.amountPiasters, lang)} · {r.reason}
                </span>
                <span className="flex items-center gap-2">
                  {a.orders.refundStatus[r.status]}
                  {r.status === "requested" && caps.refundsApprove ? (
                    <>
                      <Form method="post">
                        {hidden("refund-approve")}
                        <input type="hidden" name="refundId" value={r.id} />
                        <button type="submit" className={btnPrimary}>
                          {a.orders.approve}
                        </button>
                      </Form>
                      <Form method="post">
                        {hidden("refund-reject")}
                        <input type="hidden" name="refundId" value={r.id} />
                        <button type="submit" className={btnOutline}>
                          {a.orders.reject}
                        </button>
                      </Form>
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {caps.refundsRequest && o.paymentStatus === "paid" ? (
          <Form method="post" className="flex flex-wrap items-end gap-2">
            {hidden("refund-request")}
            <label className="text-sm">
              {a.orders.refundAmount}
              <input name="amount" required inputMode="decimal" dir="ltr" className={inputCls} />
            </label>
            <label className="text-sm">
              {a.orders.refundReason}
              <input name="reason" required minLength={3} maxLength={300} className={inputCls} />
            </label>
            <button type="submit" className={btnOutline}>
              {a.orders.refundRequest}
            </button>
          </Form>
        ) : null}
      </section>

      <section aria-labelledby="events-h">
        <h2 id="events-h" className="mb-2 text-lg font-bold">
          {a.orders.events}
        </h2>
        <ol className="grid gap-1 text-sm text-muted">
          {events.map((e) => (
            <li key={e.id}>
              <time dateTime={e.createdAt.toISOString()}>
                {e.createdAt.toISOString().slice(0, 16).replace("T", " ")}
              </time>{" "}
              · {e.type}
              {e.fromValue || e.toValue ? ` (${e.fromValue ?? "—"} → ${e.toValue ?? "—"})` : ""} ·{" "}
              {e.actorType}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
