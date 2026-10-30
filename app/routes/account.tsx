import { Form, redirect } from "react-router";
import type { Route } from "./+types/account";
import { useT } from "~/i18n/context";
import { btnOutline, container } from "~/components/ui";
import { logoutCustomer } from "../../server/auth/customer";
import { assertSameOrigin, clearCookie, CUSTOMER_COOKIE, peekCustomer } from "../../server/http/session";

export function meta() {
  return [{ name: "robots", content: "noindex,nofollow" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { session } = await peekCustomer(request, context);
  if (!session) throw redirect(`/${params.lang}/account/login`);
  return { name: session.customer.name, email: session.customer.email };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  assertSameOrigin(request);
  const { session, scope } = await peekCustomer(request, context);
  if (session) await logoutCustomer(scope.db, session);
  return redirect(`/${params.lang}`, { headers: { "Set-Cookie": clearCookie(scope, CUSTOMER_COOKIE) } });
}

export default function Account({ loaderData }: Route.ComponentProps) {
  const { a } = useT();
  return (
    <div className={`${container} max-w-xl py-12`}>
      <h1 className="text-2xl font-bold">
        {a.account.welcome}, {loaderData.name}
      </h1>
      <p className="mt-1 text-muted" dir="ltr">
        {loaderData.email}
      </p>
      <Form method="post" className="mt-6">
        <button type="submit" className={btnOutline}>
          {a.account.logout}
        </button>
      </Form>
    </div>
  );
}
