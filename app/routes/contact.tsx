import { Form, useActionData } from "react-router";
import { ZodError } from "zod";
import type { Route } from "./+types/contact";
import { DEFAULT_LOCALE, isLocale } from "~/i18n/config";
import { useT } from "~/i18n/context";
import { Field, FormError, SubmitButton } from "~/components/form";
import { btnPrimary, container } from "~/components/ui";
import { pageMeta, siteOrigin } from "~/lib/seo";
import { getScope, assertSameOrigin, clientIp } from "../../server/http/session";
import { createTicket } from "../../server/support/tickets";
import { TooManyRequestsError } from "../../server/security/throttle";

const T = {
  ar: {
    title: "تواصل معنا",
    intro: "اكتب لنا وسنرد عليك على الهاتف أو البريد الذي تتركه.",
    name: "الاسم",
    email: "البريد الإلكتروني (اختياري إن تركت الهاتف)",
    phone: "الهاتف (اختياري إن تركت البريد)",
    order: "رقم الطلب (اختياري)",
    message: "رسالتك",
    send: "إرسال",
    invalid: "راجع البيانات: الاسم والرسالة (١٠ أحرف على الأقل) وبريد أو هاتف صحيح.",
    tooMany: "محاولات كثيرة. حاول لاحقًا.",
    sent: "وصلتنا رسالتك. رقم المتابعة:",
  },
  en: {
    title: "Contact us",
    intro: "Write to us and we will reply by the phone or email you leave.",
    name: "Name",
    email: "Email (optional if you leave a phone)",
    phone: "Phone (optional if you leave an email)",
    order: "Order reference (optional)",
    message: "Your message",
    send: "Send",
    invalid: "Check your details: a name, a message of at least 10 characters, and a valid email or phone.",
    tooMany: "Too many attempts. Please try later.",
    sent: "We received your message. Reference:",
  },
} as const;

export function loader({ context }: Route.LoaderArgs) {
  const scope = getScope(context);
  return { siteUrl: siteOrigin(scope.env.SITE_URL), index: scope.env.APP_ENV === "production" };
}

export function meta({ loaderData: d, params }: Route.MetaArgs) {
  const lang = isLocale(params.lang) ? params.lang : DEFAULT_LOCALE;
  return pageMeta({
    siteUrl: d?.siteUrl ?? "",
    index: d?.index ?? false,
    lang,
    paths: { ar: "/ar/contact", en: "/en/contact" },
    title: `${T[lang].title} | SHROUK`,
    description: T[lang].intro,
  });
}

export async function action({ request, context, params }: Route.ActionArgs) {
  assertSameOrigin(request);
  const lang = isLocale(params.lang) ? params.lang : DEFAULT_LOCALE;
  const form = Object.fromEntries(await request.formData());
  // Hidden field real visitors never fill; pretend success so bots learn nothing.
  if (typeof form.website === "string" && form.website !== "") return { ref: "T-00000000" };
  try {
    const { ref } = await createTicket(
      getScope(context).db,
      {
        name: form.name,
        email: form.email ?? "",
        phone: form.phone ?? "",
        orderRef: form.orderRef ?? "",
        message: form.message,
        locale: lang,
      },
      clientIp(request),
    );
    return { ref };
  } catch (e) {
    if (e instanceof TooManyRequestsError) return { error: "tooMany" as const };
    if (e instanceof ZodError) return { error: "invalid" as const };
    throw e;
  }
}

export default function Contact() {
  const { lang } = useT();
  const t = T[lang];
  const result = useActionData<typeof action>();
  return (
    <div className={`${container} max-w-xl py-12`}>
      <h1 className="text-3xl font-bold">{t.title}</h1>
      <p className="mt-2 text-muted">{t.intro}</p>
      {result && "ref" in result ? (
        <p role="status" className="mt-6 rounded-card bg-panel p-4">
          {t.sent}{" "}
          <span dir="ltr" className="font-semibold">
            {result.ref}
          </span>
        </p>
      ) : (
        <Form method="post" className="mt-6 space-y-4">
          <FormError>{result && "error" in result ? t[result.error] : null}</FormError>
          <Field label={t.name} name="name" autoComplete="name" required />
          <Field label={t.email} name="email" type="email" autoComplete="email" dir="ltr" required={false} />
          <Field label={t.phone} name="phone" type="tel" autoComplete="tel" dir="ltr" required={false} />
          <Field label={t.order} name="orderRef" dir="ltr" required={false} />
          <label className="grid gap-1 text-sm">
            {t.message}
            <textarea
              name="message"
              required
              minLength={10}
              maxLength={2000}
              rows={6}
              className="rounded-input border border-sand bg-surface px-3 py-2.5"
            />
          </label>
          <div aria-hidden="true" className="absolute -start-[9999px]">
            <label>
              Website
              <input name="website" tabIndex={-1} autoComplete="off" />
            </label>
          </div>
          <SubmitButton className={`${btnPrimary} w-full`}>{t.send}</SubmitButton>
        </Form>
      )}
    </div>
  );
}
