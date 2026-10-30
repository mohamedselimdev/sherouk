import { Form, Link, redirect, useActionData } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/account-login";
import { useT } from "~/i18n/context";
import { Field, FormError, SubmitButton } from "~/components/form";
import { btnPrimary, container } from "~/components/ui";
import { AuthError } from "../../server/auth/staff";
import { loginCustomer } from "../../server/auth/customer";
import { TooManyRequestsError } from "../../server/security/throttle";
import {
  assertSameOrigin,
  clientIp,
  CUSTOMER_COOKIE,
  peekCustomer,
  sessionCookie,
} from "../../server/http/session";

export function meta({ params }: Route.MetaArgs) {
  const title = params.lang === "ar" ? "تسجيل الدخول" : "Sign in";
  return [{ title: `${title} | SHROUK` }, { name: "robots", content: "noindex,nofollow" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { session } = await peekCustomer(request, context);
  if (session) throw redirect(`/${params.lang}/account`);
  return null;
}

const credentials = z.object({
  email: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(200),
});

export async function action({ request, context, params }: Route.ActionArgs) {
  assertSameOrigin(request);
  const { scope } = await peekCustomer(request, context);
  const parsed = credentials.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return { error: "invalid" as const };
  try {
    const { token } = await loginCustomer(scope.db, { ...parsed.data, ip: clientIp(request) });
    return redirect(`/${params.lang}/account`, {
      headers: { "Set-Cookie": sessionCookie(scope, CUSTOMER_COOKIE, token, 30 * 24 * 3600, "Lax") },
    });
  } catch (e) {
    if (e instanceof TooManyRequestsError) return { error: "tooMany" as const };
    if (e instanceof AuthError) return { error: "invalid" as const };
    throw e;
  }
}

export default function AccountLogin() {
  const { a, lang } = useT();
  const result = useActionData<typeof action>();
  return (
    <div className={`${container} max-w-md py-12`}>
      <h1 className="text-2xl font-bold">{a.account.login}</h1>
      <Form method="post" className="mt-6 space-y-4">
        <FormError>
          {result?.error === "tooMany" ? a.account.tooMany : result?.error ? a.account.invalid : null}
        </FormError>
        <Field label={a.account.email} name="email" type="email" autoComplete="username" dir="ltr" />
        <Field
          label={a.account.password}
          name="password"
          type="password"
          autoComplete="current-password"
          dir="ltr"
        />
        <SubmitButton className={`${btnPrimary} w-full`}>{a.account.login}</SubmitButton>
      </Form>
      <p className="mt-4 text-sm text-muted">
        {a.account.noAccount}{" "}
        <Link to={`/${lang}/account/register`} className="text-cta underline">
          {a.account.register}
        </Link>
      </p>
    </div>
  );
}
