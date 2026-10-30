import { useEffect, useState } from "react";
import type { Quote } from "../../server/orders/service";
import type { CartLine } from "./cart";

export type QuoteState =
  | { status: "idle" | "loading"; quote: Quote | null; error: null }
  | { status: "ok"; quote: Quote; error: null }
  | { status: "error"; quote: null; error: "unavailable" | "network" | string };

/**
 * Asks the server to price the cart (prices, shipping, coupon). The result is what the customer will be charged;
 * the browser's own numbers are never trusted. Re-runs when lines, governorate, coupon or delivery method change.
 */
export function useQuote(
  lang: string,
  lines: CartLine[],
  opts: { governorate?: string; coupon?: string; delivery?: "delivery" | "pickup" },
): QuoteState {
  const [state, setState] = useState<QuoteState>({ status: "idle", quote: null, error: null });
  const signature = JSON.stringify([
    lines.map((l) => [l.variantId, l.qty]),
    opts.governorate ?? "",
    opts.coupon ?? "",
    opts.delivery ?? "delivery",
  ]);

  useEffect(() => {
    if (lines.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({ status: "idle", quote: null, error: null });
      return;
    }
    const controller = new AbortController();
    setState((s) => ({ status: "loading", quote: s.quote, error: null }));
    fetch(`/${lang}/api/quote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        lines: lines.map((l) => ({ variantId: l.variantId, quantity: l.qty })),
        governorate: opts.governorate || null,
        couponCode: opts.coupon || null,
        deliveryMethod: opts.delivery ?? "delivery",
      }),
    })
      .then((r) => r.json() as Promise<{ ok: true; quote: Quote } | { ok: false; error: string }>)
      .then((body) =>
        setState(
          body.ok
            ? { status: "ok", quote: body.quote, error: null }
            : { status: "error", quote: null, error: body.error },
        ),
      )
      .catch((e: Error) => {
        if (e.name !== "AbortError") setState({ status: "error", quote: null, error: "network" });
      });
    return () => controller.abort();
    // `signature` captures every input that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, lang]);

  return state;
}
