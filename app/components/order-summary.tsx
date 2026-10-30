import { useState } from "react";
import { useT } from "~/i18n/context";
import { formatEGP } from "~/lib/format";
import { useCart } from "~/lib/cart";
import type { QuoteState } from "~/lib/quote";
import { btnPrimary } from "./ui";

/** Totals always come from the server's quote; before it arrives the cart's own estimate is shown in a muted style. */
export function OrderSummary({
  quote,
  cta,
  showCoupon = true,
}: {
  quote: QuoteState;
  cta: React.ReactNode;
  showCoupon?: boolean;
}) {
  const { p, lang } = useT();
  const { subtotal, count, prefs, setPrefs } = useCart();
  const [input, setInput] = useState(prefs.coupon);
  const q = quote.quote;
  const couponError =
    quote.status === "error" && (p.cart.couponErrors as Record<string, string>)[quote.error];
  const otherError =
    quote.status === "error" && !couponError
      ? quote.error === "unavailable"
        ? p.cart.unavailable
        : p.cart.quoteError
      : null;
  const estimating = !q;
  return (
    <aside
      className="h-fit rounded-card bg-panel p-5"
      aria-labelledby="summary-h"
      aria-busy={quote.status === "loading"}
    >
      <h2 id="summary-h" className="text-lg font-bold">
        {p.cart.summary}
      </h2>
      <dl className={`mt-4 space-y-3 text-sm ${estimating ? "opacity-70" : ""}`}>
        <div className="flex justify-between gap-4">
          <dt className="text-muted">
            {p.cart.subtotal} ({p.common.items(count)})
          </dt>
          <dd className="font-semibold">{formatEGP(q ? q.subtotalPiasters : subtotal, lang)}</dd>
        </div>
        {q && q.discountPiasters > 0 ? (
          <div className="flex justify-between gap-4 text-emerald-700 dark:text-emerald-300">
            <dt>
              {p.cart.discountLabel} ({q.coupon?.code})
            </dt>
            <dd>− {formatEGP(q.discountPiasters, lang)}</dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-4">
          <dt className="text-muted">{p.cart.shipping}</dt>
          <dd>{q && prefs.governorate ? formatEGP(q.shippingPiasters, lang) : p.cart.shippingValue}</dd>
        </div>
        <div className="flex justify-between gap-4 border-t border-sand pt-3 text-base">
          <dt className="font-bold">{p.cart.grandTotal}</dt>
          <dd className="font-bold">{formatEGP(q ? q.totalPiasters : subtotal, lang)}</dd>
        </div>
      </dl>
      <p className="mt-1 text-xs text-muted">{p.cart.priceNote}</p>
      {otherError ? (
        <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">
          {otherError}
        </p>
      ) : null}
      {showCoupon ? (
        <form
          className="mt-4"
          onSubmit={(e) => {
            e.preventDefault();
            setPrefs({ coupon: input.trim() });
          }}
        >
          <label htmlFor="coupon" className="mb-1 block text-sm font-medium">
            {p.cart.coupon}
          </label>
          <div className="flex gap-2">
            <input
              id="coupon"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              maxLength={40}
              autoComplete="off"
              placeholder={p.cart.couponPlaceholder}
              className="min-w-0 flex-1 rounded-input border border-sand bg-surface px-3 py-2 text-sm"
            />
            <button type="submit" className={`${btnPrimary} !px-4`}>
              {p.cart.couponApply}
            </button>
          </div>
          {couponError ? (
            <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-300">
              {couponError}
            </p>
          ) : q?.coupon ? (
            <p role="status" className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">
              {p.cart.couponApplied}
            </p>
          ) : null}
        </form>
      ) : null}
      <div className="mt-5 grid gap-3">{cta}</div>
    </aside>
  );
}
