import { data, Link } from "react-router";
import { useT } from "~/i18n/context";

export function loader() {
  throw data(null, { status: 404 });
}

export default function LocalizedNotFound() {
  const { t, lang } = useT();
  return (
    <section className="mx-auto max-w-xl px-4 py-24 text-center">
      <h1 className="text-3xl font-bold">{t.notFound.title}</h1>
      <p className="mt-3 text-muted">{t.notFound.body}</p>
      <Link to={`/${lang}`} className="mt-6 inline-block rounded-input bg-cta px-5 py-3 text-cta-fg">
        {t.notFound.back}
      </Link>
    </section>
  );
}
