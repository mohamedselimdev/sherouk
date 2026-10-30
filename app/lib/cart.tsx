/**
 * Guest cart held in the browser (localStorage): which variants and how many. It is only a shopping list.
 * Prices, discounts, shipping and availability are always decided by the server (see lib/quote.ts and
 * server/orders/service.ts); the display snapshot kept per line is replaced by the server's figures once loaded.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { L10n, StoreColor, StoreProduct } from "../../server/catalog/store";

export type CartLine = {
  variantId: string;
  slug: L10n;
  name: L10n;
  image: string | null;
  colorKey: string;
  /** Piasters when it was added (display fallback only). */
  price: number;
  qty: number;
};

export type CheckoutPrefs = { governorate: string; coupon: string };

const KEY = "shrouk-demo-cart-v2";
const PREFS_KEY = "shrouk-checkout-prefs";
const MAX_QTY = 10;

type CartApi = {
  lines: CartLine[];
  count: number;
  /** Display-only estimate from the snapshots. */
  subtotal: number;
  prefs: CheckoutPrefs;
  ready: boolean;
  add: (product: StoreProduct, color: StoreColor, qty?: number) => void;
  setQty: (variantId: string, qty: number) => void;
  remove: (variantId: string) => void;
  setPrefs: (patch: Partial<CheckoutPrefs>) => void;
  clear: () => void;
};

const CartContext = createContext<CartApi | null>(null);

function isLine(l: unknown): l is CartLine {
  const x = l as Partial<CartLine> | null;
  return (
    !!x &&
    typeof x.variantId === "string" &&
    typeof x.colorKey === "string" &&
    Number.isInteger(x.qty) &&
    Number.isInteger(x.price) &&
    typeof x.name?.ar === "string" &&
    typeof x.name?.en === "string" &&
    typeof x.slug?.ar === "string" &&
    typeof x.slug?.en === "string"
  );
}

function load(): CartLine[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isLine) : [];
  } catch {
    return [];
  }
}

function loadPrefs(): CheckoutPrefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<CheckoutPrefs>;
    return {
      governorate: typeof p.governorate === "string" ? p.governorate : "",
      coupon: typeof p.coupon === "string" ? p.coupon : "",
    };
  } catch {
    return { governorate: "", coupon: "" };
  }
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [prefs, setPrefsState] = useState<CheckoutPrefs>({ governorate: "", coupon: "" });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Hydrate from localStorage after mount; reading it during render would mismatch the server HTML.
    /* eslint-disable react-hooks/set-state-in-effect */
    setLines(load());
    setPrefsState(loadPrefs());
    setReady(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(lines));
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* storage unavailable (private mode): the cart still works for this page view */
    }
  }, [lines, prefs, ready]);

  const add = useCallback((product: StoreProduct, color: StoreColor, qty = 1) => {
    setLines((prev) => {
      const found = prev.find((l) => l.variantId === color.variantId);
      if (found) return prev.map((l) => (l === found ? { ...l, qty: Math.min(MAX_QTY, l.qty + qty) } : l));
      return [
        ...prev,
        {
          variantId: color.variantId,
          slug: product.slug,
          name: product.name,
          image: product.image,
          colorKey: color.colorKey,
          price: color.price,
          qty: Math.min(MAX_QTY, qty),
        },
      ];
    });
  }, []);
  const setQty = useCallback((variantId: string, qty: number) => {
    setLines((prev) =>
      prev.map((l) => (l.variantId === variantId ? { ...l, qty: Math.max(1, Math.min(MAX_QTY, qty)) } : l)),
    );
  }, []);
  const remove = useCallback((variantId: string) => {
    setLines((prev) => prev.filter((l) => l.variantId !== variantId));
  }, []);
  const setPrefs = useCallback(
    (patch: Partial<CheckoutPrefs>) => setPrefsState((p) => ({ ...p, ...patch })),
    [],
  );
  const clear = useCallback(() => setLines([]), []);

  const value = useMemo<CartApi>(
    () => ({
      lines,
      count: lines.reduce((n, l) => n + l.qty, 0),
      subtotal: lines.reduce((n, l) => n + l.price * l.qty, 0),
      prefs,
      ready,
      add,
      setQty,
      remove,
      setPrefs,
      clear,
    }),
    [lines, prefs, ready, add, setQty, remove, setPrefs, clear],
  );
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartApi {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside CartProvider");
  return ctx;
}
