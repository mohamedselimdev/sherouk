import { Form, Link, redirect, useActionData } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/account-register";
import { useT } from "~/i18n/context";
import { Field, FormError, SubmitButton } from "~/components/form";
import { btnPrimary, container } from "~/components/ui";
import { AuthError } from "../../server/auth/staff";
import { registerCustomer } from "../../server/auth/customer";
import { TooManyRequestsError } from "../../server/security/throttle";
import {
  assertSameOrigin,
  clientIp,
  CUSTOMER_COOKIE,
  peekCustomer,
  sessionCookie,
} from "../../server/http/session";

export function meta({ params }: Route.MetaArgs) {
  const title = params.lang === "ar" ? "إنشاء حساب" : "Create account";
  return [{ title: `${title} | SHROUK` }, { name: "robots", content: "noindex,nofollow" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { session } = await peekCustomer(request, context);
  if (session) throw redirect(`/${params.lang}/account`);
  return null;
}

const form = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email().max(254),
  password: z.string().max(200),
});

export async function action({ request, context, params }: Route.ActionArgs) {
  assertSameOrigin(request);
  const { scope } = await peekCustomer(request, context);
  const parsed = form.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return { error: "invalid" as const };
  try {
    const { token } = await registerCustomer(scope.db, { ...parsed.data, ip: clientIp(request) });
    return redirect(`/${params.lang}/account`, {
      headers: { "Set-Cookie": sessionCookie(scope, CUSTOMER_COOKIE, token, 30 * 24 * 3600, "Lax") },
    });
  } catch (e) {
    if (e instanceof TooManyRequestsError) return { error: "tooMany" as const };
    if (e instanceof AuthError)
      return { error: e.code === "weak_password" ? ("weak" as const) : ("invalid" as const) };
    throw e;
  }
}

export default function AccountRegister() {
  const { a, lang } = useT();
  const result = useActionData<typeof action>();
  const message =
    result?.error === "tooMany"
      ? a.account.tooMany
      : result?.error === "weak"
        ? a.account.weak
        : result?.error
          ? a.account.invalid
          : null;
  return (
    <div className={`${container} max-w-md py-12`}>
      <h1 className="text-2xl font-bold">{a.account.register}</h1>
      <Form method="post" className="mt-6 space-y-4">
        <FormError>{message}</FormError>
        <Field label={a.account.name} name="name" autoComplete="name" />
        <Field label={a.account.email} name="email" type="email" autoComplete="email" dir="ltr" />
        <Field
          label={a.account.password}
          name="password"
          type="password"
          autoComplete="new-password"
          hint={a.auth.passwordHint}
          dir="ltr"
        />
        <SubmitButton className={`${btnPrimary} w-full`}>{a.account.register}</SubmitButton>
      </Form>
      <p className="mt-4 text-sm text-muted">
        {a.account.haveAccount}{" "}
        <Link to={`/${lang}/account/login`} className="text-cta underline">
          {a.account.login}
        </Link>
      </p>
    </div>
  );
}
