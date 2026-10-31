import { Link } from "react-router";
import { DIRECTION } from "~/i18n/config";
import { useT } from "~/i18n/context";
import { container } from "./ui";

export function Footer() {
  const { t, p, lang } = useT();
  const link = "hover:underline";
  return (
    <footer className="bg-footer-bg text-footer-fg">
      <div className={`${container} grid gap-8 py-10 sm:grid-cols-2 lg:grid-cols-4`}>
        <div>
          <img
            src="/assets/brand/logo-horizontal-dark-outlined.svg"
            alt=""
            width={152}
            height={42}
            className="h-11 w-auto"
          />
          <p className="mt-3 text-sm opacity-80">{t.tagline}</p>
        </div>
        <nav aria-label={p.footer.shop}>
          <h2 className="mb-3 font-semibold">{p.footer.shop}</h2>
          <ul className="space-y-2 text-sm opacity-90">
            <li>
              <Link className={link} to={`/${lang}/c/sunglasses`}>
                {t.nav.sunglasses}
              </Link>
            </li>
            <li>
              <Link className={link} to={`/${lang}/c/prescription`}>
                {t.nav.prescription}
              </Link>
            </li>
            <li>
              <Link className={link} to={`/${lang}/c/lenses`}>
                {t.nav.lenses}
              </Link>
            </li>
            <li>
              <Link className={link} to={`/${lang}/c/kids`}>
                {t.nav.kids}
              </Link>
            </li>
          </ul>
        </nav>
        <nav aria-label={p.footer.info}>
          <h2 className="mb-3 font-semibold">{p.footer.info}</h2>
          <ul className="space-y-2 text-sm opacity-90">
            <li>
              <Link className={link} to={`/${lang}/about`}>
                {t.nav.about}
              </Link>
            </li>
            <li>
              <Link className={link} to={`/${lang}/blog`}>
                {t.nav.blog}
              </Link>
            </li>
            <li>
              <Link className={link} to={`/${lang}/branches`}>
                {t.nav.branches}
              </Link>
            </li>
          </ul>
        </nav>
        <div>
          <h2 className="mb-3 font-semibold">{p.footer.help}</h2>
          <p className="text-sm opacity-80">{p.footer.helpBody}</p>
        </div>
      </div>
      <div className="border-t border-white/15">
        <div
          dir="ltr"
          className={`w-full px-4 sm:px-6 lg:px-8 flex flex-wrap items-center justify-between gap-3 py-3 text-xs`}
        >
          <span dir={DIRECTION[lang]}>
            © {new Date().getFullYear()} {t.brand}. {t.footer.rights}
          </span>
          <a
            href="https://mohamedselim.dev/ar"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Developed by Mohamed Selim"
            className="ms-auto flex items-center gap-2"
          >
            <span aria-hidden="true">Developed by</span>
            <span className="rounded bg-white px-1.5 py-1">
              <img src="/assets/brand/MS-logo-96.png" alt="" width={20} height={20} className="h-5 w-auto" />
            </span>
          </a>
        </div>
      </div>
    </footer>
  );
}
