import { data, redirect, type RouterContextProvider } from "react-router";
import { scopeContext, type RequestScope } from "../context";
import { getStaffSession, csrfToken, verifyCsrf, type StaffSession } from "../auth/staff";
import { getCustomerSession, type CustomerSession } from "../auth/customer";
import { canAny, loadPrincipal, requirePermission, type Permission, type Principal } from "../auth/rbac";

export const STAFF_COOKIE = "shrouk_staff";
export const CUSTOMER_COOKIE = "shrouk_customer";

export function getScope(context: Readonly<RouterContextProvider>): RequestScope {
  return context.get(scopeContext);
}

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0 && part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}

export function sessionCookie(
  scope: RequestScope,
  name: string,
  value: string,
  maxAgeSeconds: number,
  sameSite: "Strict" | "Lax",
): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    `SameSite=${sameSite}`,
    `Max-Age=${maxAgeSeconds}`,
    scope.secureCookies ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function clearCookie(scope: RequestScope, name: string): string {
  return sessionCookie(scope, name, "", 0, "Lax");
}

/**
 * CSRF defence in depth for state-changing requests: the browser must say the request is same-origin
 * (Origin, or Sec-Fetch-Site when Origin is absent). Authenticated actions additionally verify a per-session token.
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  if (origin) {
    if (origin !== url.origin) throw data("Cross-origin request blocked", { status: 403 });
    return;
  }
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none")
    throw data("Cross-origin request blocked", { status: 403 });
}

export type StaffAuth = { session: StaffSession; principal: Principal; scope: RequestScope; csrf: string };

/** Resolves the staff session for a request without enforcing anything (used by the login/MFA pages). */
export async function peekStaff(
  request: Request,
  context: Readonly<RouterContextProvider>,
): Promise<{ session: StaffSession | null; scope: RequestScope }> {
  const scope = getScope(context);
  return { session: await getStaffSession(scope.db, readCookie(request, STAFF_COOKIE)), scope };
}

/**
 * Gate for every admin loader and action: a fully verified (password + TOTP) session and, optionally, a permission.
 * Anything else is a redirect to login or a 403; there is no "partially signed in" access.
 */
export async function requireStaff(
  request: Request,
  context: Readonly<RouterContextProvider>,
  opts: {
    lang: string;
    permission?: Permission;
    /** Branch-aware screen: any scope opens it, rows are filtered by the service. */ anyScope?: boolean;
  } = { lang: "ar" },
): Promise<StaffAuth> {
  const { session, scope } = await peekStaff(request, context);
  if (!session) throw redirect(`/${opts.lang}/admin/login`);
  if (!session.mfaVerified) throw redirect(`/${opts.lang}/admin/mfa`);
  const principal = await loadPrincipal(scope.db, session.user.id);
  if (opts.permission) {
    const allowed = opts.anyScope
      ? canAny(principal, opts.permission)
      : (() => {
          try {
            requirePermission(principal, opts.permission!);
            return true;
          } catch {
            return false;
          }
        })();
    if (!allowed) throw data("Forbidden", { status: 403 });
  }
  return { session, principal, scope, csrf: await csrfToken(scope.authConfig, session) };
}

/** For mutating admin actions: same-origin plus the session-bound CSRF token from the submitted form. */
export async function requireStaffAction(
  request: Request,
  context: Readonly<RouterContextProvider>,
  opts: { lang: string; permission?: Permission; anyScope?: boolean },
): Promise<{ auth: StaffAuth; form: FormData }> {
  assertSameOrigin(request);
  const auth = await requireStaff(request, context, opts);
  const form = await request.formData();
  if (!(await verifyCsrf(auth.scope.authConfig, auth.session, form.get("_csrf")?.toString())))
    throw data("Invalid CSRF token", { status: 403 });
  return { auth, form };
}

export async function peekCustomer(
  request: Request,
  context: Readonly<RouterContextProvider>,
): Promise<{ session: CustomerSession | null; scope: RequestScope }> {
  const scope = getScope(context);
  return { session: await getCustomerSession(scope.db, readCookie(request, CUSTOMER_COOKIE)), scope };
}

export function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}
