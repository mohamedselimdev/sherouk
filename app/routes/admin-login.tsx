import { Form, redirect, useActionData, useNavigation } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/admin-login";
import { useT } from "~/i18n/context";
import { Field, FormError, SubmitButton } from "~/components/form";
import { btnPrimary } from "~/components/ui";
import { AuthError, loginWithPassword } from "../../server/auth/staff";
import { TooManyRequestsError } from "../../server/security/throttle";
import {
  assertSameOrigin,
  clientIp,
  peekStaff,
  sessionCookie,
  STAFF_COOKIE,
} from "../../server/http/session";

const credentials = z.object({
  email: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(200),
});

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { session } = await peekStaff(request, context);
  if (session?.mfaVerified) throw redirect(`/${params.lang}/admin`);
  if (session) throw redirect(`/${params.lang}/admin/mfa`);
  return null;
}

export async function action({ request, context, params }: Route.ActionArgs) {
  assertSameOrigin(request);
  const { scope } = await peekStaff(request, context);
  const parsed = credentials.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return { error: "invalid" as const };
  try {
    const { token } = await loginWithPassword(scope.db, {
      ...parsed.data,
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent") ?? undefined,
    });
    // Pending session: valid for 10 minutes and grants nothing until the second factor is verified.
    return redirect(`/${params.lang}/admin/mfa`, {
      headers: { "Set-Cookie": sessionCookie(scope, STAFF_COOKIE, token, 600, "Strict") },
    });
  } catch (error) {
    if (error instanceof TooManyRequestsError) return { error: "tooMany" as const };
    if (error instanceof AuthError) return { error: "invalid" as const };
    throw error;
  }
}

export default function AdminLogin() {
  const { a } = useT();
  const result = useActionData<typeof action>();
  const busy = useNavigation().state === "submitting";
  return (
    <Form method="post" className="space-y-4">
      <h1 className="text-xl font-bold">{a.auth.staffTitle}</h1>
      <FormError>
        {result?.error === "tooMany" ? a.auth.tooMany : result?.error ? a.auth.invalid : null}
      </FormError>
      <Field label={a.auth.email} name="email" type="email" autoComplete="username" dir="ltr" />
      <Field
        label={a.auth.password}
        name="password"
        type="password"
        autoComplete="current-password"
        dir="ltr"
      />
      <SubmitButton className={`${btnPrimary} w-full`}>{busy ? "…" : a.auth.signIn}</SubmitButton>
    </Form>
  );
}
