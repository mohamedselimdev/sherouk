import { Form, redirect, useActionData } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/admin-accept-invite";
import { useT } from "~/i18n/context";
import { isLocale } from "~/i18n/config";
import { Field, FormError, SubmitButton } from "~/components/form";
import { btnPrimary } from "~/components/ui";
import { acceptInvite, AuthError } from "../../server/auth/staff";
import { hit, TooManyRequestsError } from "../../server/security/throttle";
import { assertSameOrigin, clientIp, getScope } from "../../server/http/session";

const form = z.object({
  token: z.string().min(20).max(100),
  displayName: z.string().trim().min(1).max(100),
  password: z.string().max(200),
});

export function loader({ request }: Route.LoaderArgs) {
  return { token: new URL(request.url).searchParams.get("token") ?? "" };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  assertSameOrigin(request);
  const scope = getScope(context);
  const parsed = form.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return { error: "inviteInvalid" as const };
  try {
    await hit(scope.db, `invite-accept:ip:${clientIp(request)}`, 10, 3600);
    await acceptInvite(scope.db, { ...parsed.data, locale: isLocale(params.lang) ? params.lang : "ar" });
  } catch (error) {
    if (error instanceof TooManyRequestsError) return { error: "tooMany" as const };
    if (error instanceof AuthError)
      return { error: error.code === "weak_password" ? ("weak" as const) : ("inviteInvalid" as const) };
    // A duplicate email surfaces as a unique violation: report the same generic error.
    if ((error as { cause?: { code?: string } }).cause?.code === "23505")
      return { error: "inviteInvalid" as const };
    throw error;
  }
  return redirect(`/${params.lang}/admin/login`);
}

export default function AcceptInvite({ loaderData }: Route.ComponentProps) {
  const { a } = useT();
  const result = useActionData<typeof action>();
  const message =
    result?.error === "tooMany"
      ? a.auth.tooMany
      : result?.error === "weak"
        ? a.auth.weakPassword
        : result?.error
          ? a.auth.inviteInvalid
          : null;
  return (
    <Form method="post" className="space-y-4">
      <h1 className="text-xl font-bold">{a.auth.inviteTitle}</h1>
      <FormError>{message}</FormError>
      <input type="hidden" name="token" value={loaderData.token} />
      <Field label={a.auth.displayName} name="displayName" autoComplete="name" />
      <Field
        label={a.auth.newPassword}
        name="password"
        type="password"
        autoComplete="new-password"
        hint={a.auth.passwordHint}
        dir="ltr"
      />
      <SubmitButton className={`${btnPrimary} w-full`}>{a.auth.createAccount}</SubmitButton>
    </Form>
  );
}
