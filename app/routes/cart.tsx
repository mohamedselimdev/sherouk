import { Link } from "react-router";
import { Lock, Minus, Plus, ShoppingBag, X } from "lucide-react";
import type { Route } from "./+types/cart";
import { colorName } from "~/demo/data";
import { DEFAULT_LOCALE, isLocale } from "~/i18n/config";
import { useT } from "~/i18n/context";
import { formatEGP } from "~/lib/format";
import { useCart } from "~/lib/cart";
import { useQuote } from "~/lib/quote";
import { OrderSummary } from "~/components/order-summary";
import { inputCls } from "~/components/form";
import {
  btnOutline,
  btnPrimary,
  container,
  EndArrow,
  ProductCard,
  ProductImage,
  SectionHeading,
  TrustStrip,
} from "~/components/ui";
import { listStoreProducts } from "../../server/catalog/store";
import { GOVERNORATES } from "../../server/fulfillment/governorates";
import { getScope } from "../../server/http/session";

export function meta({ params }: Route.MetaArgs) {
  const lang = isLocale(params.lang) ? params.lang : DEFAULT_LOCALE;
  return [{ title: `${lang === "ar" ? "السلة" : "Cart"} | SHROUK` }, { name: "robots", content: "noindex" }];
}

export async function loader({ context }: Route.LoaderArgs) {
  const products = await listStoreProducts(getScope(context).catalogDb);
  return { suggestions: products.slice(0, 4) };
}

export default function Cart({ loaderData }: Route.ComponentProps) {
  const { p, lang } = useT();
  const { lines, setQty, remove, count, prefs, setPrefs } = useCart();
  const quote = useQuote(lang, lines, { governorate: prefs.governorate, coupon: prefs.coupon });
  const priced = new Map(quote.quote?.lines.map((l) => [l.variantId, l.unitPricePiasters]));

  return (
    <div className={`${container} py-8`}>
      <div className="flex flex-wrap items-center gap-3">
        <ShoppingBag className="size-7" aria-hidden />
        <h1 className="text-3xl font-bold">{p.cart.title}</h1>
        <span className="text-muted">({p.common.items(count)})</span>
      </div>

      {lines.length === 0 ? (
        <div className="mt-8 rounded-card bg-panel p-10 text-center">
          <h2 className="text-xl font-bold">{p.cart.empty}</h2>
          <p className="mt-2 text-muted">{p.cart.emptyBody}</p>
          <Link to={`/${lang}/shop`} className={`${btnPrimary} mt-5`}>
            {p.cart.continue}
          </Link>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-3">
            {lines.map((line) => {
              const unit = priced.get(line.variantId) ?? line.price;
              return (
                <li
                  key={line.variantId}
                  className="grid grid-cols-[6rem_1fr] gap-4 rounded-card bg-panel p-3 sm:grid-cols-[8rem_1fr_auto]"
                >
                  <ProductImage src={line.image} />
                  <div className="min-w-0">
                    <h2 className="font-semibold">
                      <Link to={`/${lang}/p/${line.slug[lang]}`} className="hover:underline">
                        {line.name[lang]}
                      </Link>
                    </h2>
                    <p className="text-sm text-muted">
                      {p.common.colors}: {colorName(line.colorKey, lang)}
                    </p>
                    <p className="mt-1 text-sm">{formatEGP(unit, lang)}</p>
                    <div className="mt-3 flex items-center gap-3">
                      <div
                        className="inline-flex items-center rounded-input border border-sand bg-surface"
                        role="group"
                        aria-label={p.cart.qty}
                      >
                        <button
                          type="button"
                          aria-label="−"
                          disabled={line.qty <= 1}
                          onClick={() => setQty(line.variantId, line.qty - 1)}
                          className="grid size-9 place-items-center disabled:opacity-40"
                        >
                          <Minus className="size-4" aria-hidden />
                        </button>
                        <span className="min-w-8 text-center text-sm" aria-live="polite">
                          {line.qty}
                        </span>
                        <button
                          type="button"
                          aria-label="+"
                          disabled={line.qty >= 10}
                          onClick={() => setQty(line.variantId, line.qty + 1)}
                          className="grid size-9 place-items-center disabled:opacity-40"
                        >
                          <Plus className="size-4" aria-hidden />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => remove(line.variantId)}
                        className="inline-flex items-center gap-1 text-sm text-muted hover:text-cta"
                      >
                        <X className="size-4" aria-hidden />
                        {p.cart.remove}
                      </button>
                    </div>
                  </div>
                  <p className="col-span-2 text-end font-bold sm:col-span-1">
                    {formatEGP(unit * line.qty, lang)}
                  </p>
                </li>
              );
            })}
          </ul>
          <div className="grid h-fit grid-cols-[minmax(0,1fr)] gap-4">
            <label className="block text-sm font-medium">
              {p.cart.governorateLabel}
              <select
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
            <OrderSummary
              quote={quote}
              cta={
                <>
                  <Link to={`/${lang}/checkout`} className={btnPrimary}>
                    <Lock className="size-4" aria-hidden />
                    {p.cart.checkout}
                  </Link>
                  <Link to={`/${lang}/shop`} className={btnOutline}>
                    <EndArrow className="size-4 rotate-180" />
                    {p.cart.continue}
                  </Link>
                </>
              }
            />
          </div>
        </div>
      )}

      <TrustStrip className="mt-8" />
      <section className="mt-10">
        <SectionHeading title={p.cart.alsoLike} />
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {loaderData.suggestions.map((x) => (
            <li key={x.id}>
              <ProductCard product={x} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
