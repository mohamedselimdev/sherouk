import { useEffect, useState } from "react";
import { Link } from "react-router";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Glasses,
  Headset,
  Heart,
  PackageCheck,
  RefreshCcw,
  ShieldCheck,
  ShoppingBag,
} from "lucide-react";
import type { StoreProduct } from "../../server/catalog/store";
import { colorHex, colorName } from "~/demo/data";
import { useT } from "~/i18n/context";
import { formatEGP } from "~/lib/format";
import { useCart } from "~/lib/cart";

export const btnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-input bg-cta px-5 py-3 text-sm font-semibold text-cta-fg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
export const btnOutline =
  "inline-flex items-center justify-center gap-2 rounded-input border border-cta px-5 py-3 text-sm font-semibold text-cta transition hover:bg-cta hover:text-cta-fg";
export const container = "mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8";

export const discountPct = (p: Pick<StoreProduct, "price" | "oldPrice">) =>
  p.oldPrice ? Math.round(((p.oldPrice - p.price) / p.oldPrice) * 100) : 0;

/** Arrow that points toward the reading end of the line (mirrors in RTL). */
export function EndArrow({ className }: { className?: string }) {
  const { lang } = useT();
  return lang === "ar" ? (
    <ChevronLeft className={className} aria-hidden />
  ) : (
    <ChevronRight className={className} aria-hidden />
  );
}

export function DemoBadge({ children }: { children?: React.ReactNode }) {
  const { p } = useT();
  return (
    <p className="inline-block rounded-full bg-panel px-3 py-1 text-xs font-medium text-muted">
      {children ?? p.common.demoNotice}
    </p>
  );
}

export function SectionHeading({
  title,
  href,
  linkLabel,
}: {
  title: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <h2 className="text-2xl font-bold text-fg">{title}</h2>
      {href && linkLabel ? (
        <Link
          to={href}
          className="inline-flex items-center gap-1 text-sm font-medium text-cta hover:underline"
        >
          {linkLabel}
          <EndArrow className="size-4" />
        </Link>
      ) : null}
    </div>
  );
}

export function Breadcrumbs({ items }: { items: { label: string; to?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-muted">
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((item, i) => (
          <li key={item.label} className="flex items-center gap-1">
            {item.to ? (
              <Link to={item.to} className="hover:text-fg hover:underline">
                {item.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-fg">
                {item.label}
              </span>
            )}
            {i < items.length - 1 ? <span aria-hidden>/</span> : null}
          </li>
        ))}
      </ol>
    </nav>
  );
}

const TRUST_ICONS = [Headset, PackageCheck, ShieldCheck, RefreshCcw];

export function TrustStrip({ className = "" }: { className?: string }) {
  const { p } = useT();
  return (
    <ul className={`grid grid-cols-2 gap-4 rounded-card bg-panel p-4 sm:grid-cols-4 ${className}`}>
      {p.trust.map((item, i) => {
        const Icon = TRUST_ICONS[i] ?? Headset;
        return (
          <li key={item.title} className="flex items-center gap-3">
            <Icon className="size-7 shrink-0 text-brown" aria-hidden />
            <span className="text-sm">
              <span className="block font-semibold">{item.title}</span>
              <span className="block text-muted">{item.body}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function Swatches({ colors, size = "sm" }: { colors: readonly string[]; size?: "sm" | "md" }) {
  const { lang } = useT();
  return (
    <ul className="flex items-center gap-1.5" aria-label={lang === "ar" ? "الألوان" : "Colours"}>
      {colors.map((c) => (
        <li key={c}>
          <span
            title={colorName(c, lang)}
            className={`block rounded-full border border-black/15 ${size === "sm" ? "size-3.5" : "size-5"}`}
            style={{ background: colorHex(c) }}
          >
            <span className="sr-only">{colorName(c, lang)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

const WISH_KEY = "shrouk-demo-wishlist";

function readWish(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(WISH_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function WishlistButton({ productId, className = "" }: { productId: string; className?: string }) {
  const { p } = useT();
  const [on, setOn] = useState(false);
  useEffect(() => {
    // Same post-mount localStorage hydration as the cart.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOn(readWish().includes(productId));
  }, [productId]);
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? p.common.wishlistRemove : p.common.wishlistAdd}
      onClick={() => {
        const next = on ? readWish().filter((s) => s !== productId) : [...readWish(), productId];
        try {
          localStorage.setItem(WISH_KEY, JSON.stringify(next));
        } catch {
          /* storage unavailable: toggle still reflects for this view */
        }
        setOn(!on);
      }}
      className={`grid size-9 place-items-center rounded-full bg-surface/90 text-fg shadow-soft hover:text-cta ${className}`}
    >
      <Heart className={`size-5 ${on ? "fill-cta text-cta" : ""}`} aria-hidden />
    </button>
  );
}

export function AddToCartButton({
  product,
  colorKey,
  className = btnPrimary,
  compact = false,
}: {
  product: StoreProduct;
  colorKey?: string;
  className?: string;
  compact?: boolean;
}) {
  const { p, lang } = useT();
  const { add } = useCart();
  const [flash, setFlash] = useState(false);
  const chosen = product.colors.find((c) => c.colorKey === colorKey) ?? product.colors[0];
  return (
    <button
      type="button"
      disabled={!chosen}
      className={className}
      aria-label={compact ? `${p.common.addToCart}: ${product.name[lang]}` : undefined}
      onClick={() => {
        if (!chosen) return;
        add(product, chosen);
        setFlash(true);
        window.setTimeout(() => setFlash(false), 1600);
      }}
    >
      {flash ? <Check className="size-4" aria-hidden /> : <ShoppingBag className="size-4" aria-hidden />}
      {compact ? null : <span aria-live="polite">{flash ? p.common.added : p.common.addToCart}</span>}
    </button>
  );
}

export function Price({
  product,
  className = "",
}: {
  product: Pick<StoreProduct, "price" | "oldPrice">;
  className?: string;
}) {
  const { lang } = useT();
  return (
    <p className={`flex flex-wrap items-baseline gap-x-2 ${className}`}>
      <span className="font-bold text-fg">{formatEGP(product.price, lang)}</span>
      {product.oldPrice ? (
        <span className="text-sm text-muted line-through">
          <span className="sr-only">{lang === "ar" ? "السعر السابق" : "Was"} </span>
          {formatEGP(product.oldPrice, lang)}
        </span>
      ) : null}
    </p>
  );
}

/** Product photo/illustration; slightly oversized so rounded corners baked into the demo art are cropped. */
export function ProductImage({ src, className = "" }: { src: string | null; className?: string }) {
  return (
    <div className={`aspect-[800/490] overflow-hidden rounded-input bg-panel ${className}`}>
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          width={800}
          height={490}
          className="size-full scale-[1.05] object-cover"
        />
      ) : (
        <div className="grid size-full place-items-center text-muted">
          <Glasses className="size-10" aria-hidden />
        </div>
      )}
    </div>
  );
}

export function ProductCard({
  product,
  layout = "card",
}: {
  product: StoreProduct;
  layout?: "card" | "row";
}) {
  const { lang, p } = useT();
  const pct = discountPct(product);
  const href = `/${lang}/p/${product.slug[lang]}`;
  const badge = pct ? `${pct}% ${p.common.discount}` : product.featured ? p.common.bestSeller : null;
  const colors = product.colors.map((c) => c.colorKey);
  if (layout === "row") {
    return (
      <article className="relative flex gap-3 rounded-card bg-panel p-3">
        <div className="relative w-28 shrink-0 sm:w-36">
          <ProductImage src={product.image} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
          <div>
            {badge ? (
              <span className="mb-1 inline-block rounded bg-cta px-2 py-0.5 text-xs font-medium text-cta-fg">
                {badge}
              </span>
            ) : null}
            <h3 className="font-semibold">
              <Link to={href} className="after:absolute after:inset-0 hover:underline">
                {product.name[lang]}
              </Link>
            </h3>
            <p className="text-sm text-muted">{product.sub[lang]}</p>
            <Swatches colors={colors} />
          </div>
          <Price product={product} />
        </div>
        <div className="relative z-10 flex flex-col justify-between">
          <WishlistButton productId={product.id} />
          <AddToCartButton product={product} compact className={`${btnPrimary} !px-3`} />
        </div>
      </article>
    );
  }
  return (
    <article className="group relative flex gap-3 rounded-card bg-panel p-3 transition hover:shadow-soft sm:flex-col sm:gap-0">
      <div className="relative w-32 shrink-0 self-start sm:w-full">
        <ProductImage src={product.image} />
        {badge ? (
          <span className="absolute start-2 top-2 rounded bg-cta px-2 py-0.5 text-xs font-medium text-cta-fg">
            {badge}
          </span>
        ) : null}
        <WishlistButton productId={product.id} className="absolute end-2 top-2 z-10 !size-8 sm:!size-9" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <h3 className="font-semibold sm:mt-3">
          <Link to={href} className="after:absolute after:inset-0 hover:underline">
            {product.name[lang]}
          </Link>
        </h3>
        <p className="text-sm text-muted">{product.sub[lang]}</p>
        <div className="mt-2">
          <Swatches colors={colors} />
        </div>
        <Price product={product} className="mt-1" />
        <div className="relative z-10 mt-auto pt-3">
          <AddToCartButton product={product} className={`${btnPrimary} w-full !px-3`} />
        </div>
      </div>
    </article>
  );
}

export function PageHero({
  eyebrow,
  title,
  body,
  image,
  children,
}: {
  eyebrow?: string;
  title: string;
  body?: string;
  image: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="relative isolate overflow-hidden bg-[#f1e8df] text-[#171514]">
      <img
        src={image}
        alt=""
        fetchPriority="high"
        className="absolute inset-0 -z-10 size-full object-cover object-right"
      />
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-[#f1e8df] via-[#f1e8df]/80 to-transparent" />
      <div className={`${container} py-12 sm:py-16 lg:py-20`}>
        <div className="mr-auto max-w-xl">
          {eyebrow ? <p className="text-sm font-semibold text-cta">{eyebrow}</p> : null}
          <h1 className="mt-1 text-3xl font-bold leading-tight sm:text-4xl lg:text-5xl">{title}</h1>
          {body ? <p className="mt-3 max-w-md text-base text-[#4b2e23] sm:text-lg">{body}</p> : null}
          {children ? <div className="mt-6 flex flex-wrap gap-3">{children}</div> : null}
        </div>
      </div>
    </section>
  );
}
