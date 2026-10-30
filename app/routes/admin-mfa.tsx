import { Form, redirect, useActionData, useLoaderData } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/admin-mfa";
import { useT } from "~/i18n/context";
import { Field, FormError, SubmitButton } from "~/components/form";
import { btnPrimary } from "~/components/ui";
import { AuthError, confirmMfaEnrolment, pendingMfaSecret, verifyMfa } from "../../server/auth/staff";
import { TooManyRequestsError } from "../../server/security/throttle";
import { assertSameOrigin, peekStaff } from "../../server/http/session";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { session, scope } = await peekStaff(request, context);
  if (!session) throw redirect(`/${params.lang}/admin/login`);
  if (session.mfaVerified) throw redirect(`/${params.lang}/admin`);
  if (session.user.mfaEnrolled) return { enrol: false as const };
  const { secret, uri } = await pendingMfaSecret(scope.db, scope.authConfig, session);
  return { enrol: true as const, secret, uri };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  assertSameOrigin(request);
  const { session, scope } = await peekStaff(request, context);
  if (!session) throw redirect(`/${params.lang}/admin/login`);
  const code = z
    .string()
    .regex(/^\d{6}$/)
    .safeParse((await request.formData()).get("code")?.toString().replace(/\s/g, ""));
  if (!code.success) return { error: "invalidCode" as const };
  try {
    if (session.user.mfaEnrolled) await verifyMfa(scope.db, scope.authConfig, session, code.data);
    else await confirmMfaEnrolment(scope.db, scope.authConfig, session, code.data);
  } catch (error) {
    if (error instanceof TooManyRequestsError) return { error: "tooMany" as const };
    if (error instanceof AuthError) return { error: "invalidCode" as const };
    throw error;
  }
  return redirect(`/${params.lang}/admin`);
}

export default function AdminMfa() {
  const { a } = useT();
  const info = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  return (
    <Form method="post" className="space-y-4">
      <h1 className="text-xl font-bold">{a.auth.mfaTitle}</h1>
      <p className="text-sm text-muted">{info.enrol ? a.auth.mfaEnrolBody : a.auth.mfaVerifyBody}</p>
      {info.enrol ? (
        <div className="rounded-input border border-sand bg-panel p-3 text-sm">
          <p className="font-medium">{a.auth.secretKey}</p>
          <p className="mt-1 select-all break-all font-mono text-base tracking-wider" dir="ltr">
            {info.secret}
          </p>
          <a href={info.uri} className="mt-2 inline-block text-cta underline">
            {a.auth.openInApp}
          </a>
        </div>
      ) : null}
      <FormError>
        {result?.error === "tooMany" ? a.auth.tooMany : result?.error ? a.auth.invalidCode : null}
      </FormError>
      <Field label={a.auth.code} name="code" autoComplete="one-time-code" inputMode="numeric" dir="ltr" />
      <SubmitButton className={`${btnPrimary} w-full`}>{a.auth.verify}</SubmitButton>
    </Form>
  );
}
