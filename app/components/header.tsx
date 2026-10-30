import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { Menu, Search, ShoppingBag, X } from "lucide-react";
import { switchLocalePath } from "~/i18n/config";
import { useT } from "~/i18n/context";
import { useCart } from "~/lib/cart";
import { ThemeToggle } from "./theme-toggle";
import { container } from "./ui";

const NAV = [
  { key: "sunglasses", to: "c/sunglasses" },
  { key: "prescription", to: "c/prescription" },
  { key: "lenses", to: "c/lenses" },
  { key: "kids", to: "c/kids" },
  { key: "about", to: "about" },
  { key: "blog", to: "blog" },
  { key: "branches", to: "branches" },
] as const;

function Logo() {
  const { lang, t } = useT();
  return (
    <Link to={`/${lang}`} aria-label={`${t.brandEn} ${t.brand}`} className="inline-block shrink-0">
      <img
        src="/assets/brand/logo-horizontal-light-outlined.svg"
        alt=""
        width={152}
        height={42}
        className="h-10 w-auto sm:h-14 dark:hidden"
      />
      <img
        src="/assets/brand/logo-horizontal-dark-outlined.svg"
        alt=""
        width={152}
        height={42}
        className="hidden h-10 w-auto sm:h-14 dark:block"
      />
    </Link>
  );
}

function SearchForm({
  className = "",
  focusOnMount = false,
}: {
  className?: string;
  focusOnMount?: boolean;
}) {
  const { lang, p } = useT();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusOnMount) input.current?.focus();
  }, [focusOnMount]);
  return (
    <form
      action={`/${lang}/shop`}
      method="get"
      role="search"
      className={`flex overflow-hidden rounded-full border border-sand bg-panel ${className}`}
    >
      <label className="sr-only" htmlFor={`q-${focusOnMount ? "m" : "d"}`}>
        {p.common.search}
      </label>
      <input
        id={`q-${focusOnMount ? "m" : "d"}`}
        name="q"
        type="search"
        ref={input}
        placeholder={p.common.searchPlaceholder}
        className="min-w-0 flex-1 bg-transparent px-4 py-2 text-sm outline-none placeholder:text-muted"
      />
      <button
        type="submit"
        aria-label={p.common.search}
        className="m-1 grid size-8 place-items-center rounded-full bg-cta text-cta-fg"
      >
        <Search className="size-4" aria-hidden />
      </button>
    </form>
  );
}

export function Header() {
  const { t, p, lang } = useT();
  const { count } = useCart();
  const { pathname } = useLocation();
  // Menus are tied to the pathname they were opened on, so navigating closes them without an effect.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [searchFor, setSearchFor] = useState<string | null>(null);
  const menuOpen = menuFor === pathname;
  const searchOpen = searchFor === pathname;
  const setMenuOpen = (next: boolean | ((v: boolean) => boolean)) =>
    setMenuFor((typeof next === "function" ? next(menuOpen) : next) ? pathname : null);
  const setSearchOpen = (next: boolean | ((v: boolean) => boolean)) =>
    setSearchFor((typeof next === "function" ? next(searchOpen) : next) ? pathname : null);
  const menuBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuFor(null);
        menuBtn.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const otherLang = lang === "ar" ? "en" : "ar";
  const langLink = (
    <Link
      to={switchLocalePath(pathname, otherLang)}
      reloadDocument
      hrefLang={otherLang}
      lang={otherLang}
      className="rounded-input border border-sand px-3 py-2 text-sm font-medium hover:bg-panel"
    >
      {t.actions.language}
    </Link>
  );
  const cartLink = (
    <Link
      to={`/${lang}/cart`}
      aria-label={`${p.common.cart}${count ? ` (${count})` : ""}`}
      className="relative grid size-10 place-items-center rounded-full hover:bg-panel"
    >
      <ShoppingBag className="size-6" aria-hidden />
      {count > 0 ? (
        <span
          aria-hidden
          className="absolute -end-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full bg-cta px-1 text-[11px] font-bold text-cta-fg"
        >
          {count}
        </span>
      ) : null}
    </Link>
  );

  return (
    <header className="relative z-30 border-b border-sand bg-surface">
      <div className={`${container} grid grid-cols-[1fr_auto_1fr] items-center gap-3 py-3`}>
        <div className="flex items-center gap-2">
          <button
            ref={menuBtn}
            type="button"
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            aria-label={menuOpen ? p.common.close : p.common.menu}
            onClick={() => setMenuOpen((v) => !v)}
            className="grid size-10 place-items-center rounded-full hover:bg-panel lg:hidden"
          >
            {menuOpen ? <X className="size-6" aria-hidden /> : <Menu className="size-6" aria-hidden />}
          </button>
          <SearchForm className="hidden w-full max-w-sm lg:flex" />
        </div>
        <Logo />
        <div className="flex items-center justify-end gap-1 sm:gap-2">
          <button
            type="button"
            aria-expanded={searchOpen}
            aria-label={p.common.search}
            onClick={() => setSearchOpen((v) => !v)}
            className="grid size-10 place-items-center rounded-full hover:bg-panel lg:hidden"
          >
            <Search className="size-6" aria-hidden />
          </button>
          <div className="hidden items-center gap-2 lg:flex">
            <ThemeToggle />
            {langLink}
          </div>
          {cartLink}
        </div>
      </div>

      {searchOpen ? (
        <div className={`${container} pb-3 lg:hidden`}>
          <SearchForm focusOnMount />
        </div>
      ) : null}

      <nav aria-label="Main" className="hidden border-t border-sand lg:block">
        <ul className={`${container} flex items-center justify-center gap-1 py-1 text-sm`}>
          {NAV.map((item) => (
            <li key={item.key}>
              <NavLink
                to={`/${lang}/${item.to}`}
                className={({ isActive }) =>
                  `block whitespace-nowrap rounded-input px-3 py-2 hover:bg-panel ${isActive ? "font-semibold text-cta" : ""}`
                }
              >
                {t.nav[item.key]}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <AnimatePresence>
        {menuOpen ? (
          <motion.div
            id="mobile-menu"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-x-0 top-full border-b border-sand bg-surface shadow-soft lg:hidden"
          >
            <nav aria-label="Mobile" className={`${container} py-3`}>
              <ul className="grid gap-1">
                {NAV.map((item) => (
                  <li key={item.key}>
                    <NavLink
                      to={`/${lang}/${item.to}`}
                      className="block rounded-input px-3 py-3 text-base hover:bg-panel"
                    >
                      {t.nav[item.key]}
                    </NavLink>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex items-center gap-2 border-t border-sand pt-3">
                <ThemeToggle />
                {langLink}
              </div>
            </nav>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
