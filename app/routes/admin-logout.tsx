import { redirect } from "react-router";
import type { Route } from "./+types/admin-logout";
import { logoutStaff, verifyCsrf } from "../../server/auth/staff";
import { assertSameOrigin, clearCookie, peekStaff, STAFF_COOKIE } from "../../server/http/session";

export function loader({ params }: Route.LoaderArgs) {
  return redirect(`/${params.lang}/admin/login`);
}

export async function action({ request, context, params }: Route.ActionArgs) {
  assertSameOrigin(request);
  const { session, scope } = await peekStaff(request, context);
  if (session) {
    const form = await request.formData();
    if (await verifyCsrf(scope.authConfig, session, form.get("_csrf")?.toString()))
      await logoutStaff(scope.db, session);
  }
  return redirect(`/${params.lang}/admin/login`, {
    headers: { "Set-Cookie": clearCookie(scope, STAFF_COOKIE) },
  });
}
