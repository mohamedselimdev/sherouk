import { Form, useActionData, useOutletContext } from "react-router";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Route } from "./+types/admin-staff";
import type { AdminOutletContext } from "~/layouts/admin";
import { useT } from "~/i18n/context";
import { Field, FormError, FormOk, inputCls, SubmitButton } from "~/components/form";
import { branchTranslations, branches, users } from "../../db/schema";
import { audit } from "../../server/audit";
import { createInvite, revokeAllSessions } from "../../server/auth/staff";
import { ForbiddenError, requirePermission, ROLE_DEFS } from "../../server/auth/rbac";
import { requireStaff, requireStaffAction } from "../../server/http/session";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { scope } = await requireStaff(request, context, { lang: params.lang, permission: "staff:read" });
  const [staff, brs] = await Promise.all([
    scope.db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        status: users.status,
        mfa: users.mfaEnrolledAt,
      })
      .from(users)
      .orderBy(users.createdAt),
    scope.db
      .select({ id: branches.id, name: branchTranslations.name })
      .from(branches)
      .innerJoin(branchTranslations, eq(branchTranslations.branchId, branches.id))
      .where(eq(branchTranslations.locale, params.lang === "en" ? "en" : "ar")),
  ]);
  return {
    staff,
    branches: brs,
    roleKeys: Object.entries(ROLE_DEFS).map(([key, d]) => ({ key, name: d.name })),
  };
}

const inviteForm = z.object({
  email: z.email().max(254),
  roleKey: z.string().max(40),
  branchId: z.union([z.uuid(), z.literal("")]).transform((v) => (v === "" ? null : v)),
});

export async function action({ request, context, params }: Route.ActionArgs) {
  const { auth, form } = await requireStaffAction(request, context, {
    lang: params.lang,
    permission: "staff:manage",
  });
  const { scope, principal } = auth;
  try {
    requirePermission(principal, "staff:manage");
    const intent = form.get("intent")?.toString();
    if (intent === "invite") {
      const parsed = inviteForm.safeParse(Object.fromEntries(form));
      if (!parsed.success || !(parsed.data.roleKey in ROLE_DEFS)) return { error: "invalid" as const };
      const { token } = await createInvite(scope.db, { actorId: principal.userId, ...parsed.data });
      return { invite: `/${params.lang}/admin/accept-invite?token=${token}` };
    }
    if (intent === "deactivate") {
      const id = z.uuid().safeParse(form.get("userId"));
      if (!id.success || id.data === principal.userId) return { error: "invalid" as const };
      await scope.db.update(users).set({ status: "disabled" }).where(eq(users.id, id.data));
      await revokeAllSessions(scope.db, id.data, principal.userId);
      await audit(scope.db, {
        actorId: principal.userId,
        action: "staff.deactivated",
        entityType: "user",
        entityId: id.data,
      });
      return { done: true as const };
    }
    return { error: "invalid" as const };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "forbidden" as const };
    throw e;
  }
}

export default function AdminStaff({ loaderData }: Route.ComponentProps) {
  const { a } = useT();
  const { csrf, caps } = useOutletContext<AdminOutletContext>();
  const result = useActionData<typeof action>();
  const { staff, branches: brs, roleKeys } = loaderData;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{a.staff.title}</h1>
      <FormError>{result && "error" in result ? a.products.invalidInput : null}</FormError>
      <FormOk>{result && "done" in result ? a.staff.done : null}</FormOk>
      {result && "invite" in result ? (
        <div className="rounded-card border border-sand bg-panel p-4 text-sm">
          <p className="font-semibold">{a.staff.linkTitle}</p>
          <p className="mt-1 select-all break-all font-mono" dir="ltr">
            {result.invite}
          </p>
        </div>
      ) : null}

      <ul className="grid gap-3">
        {staff.map((s) => (
          <li
            key={s.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-sand bg-surface p-4 text-sm"
          >
            <span>
              <span className="block font-semibold">{s.displayName}</span>
              <span className="block text-muted" dir="ltr">
                {s.email}
              </span>
            </span>
            <span className="text-muted">
              {s.status === "active" ? a.staff.active : a.staff.disabled} · {a.staff.mfa}:{" "}
              {s.mfa ? a.staff.on : a.staff.off}
            </span>
            {caps.staffManage && s.status === "active" ? (
              <Form method="post">
                <input type="hidden" name="_csrf" value={csrf} />
                <input type="hidden" name="intent" value="deactivate" />
                <input type="hidden" name="userId" value={s.id} />
                <button type="submit" className="text-cta underline">
                  {a.staff.deactivate}
                </button>
              </Form>
            ) : null}
          </li>
        ))}
      </ul>

      {caps.staffManage ? (
        <Form
          method="post"
          className="grid gap-4 rounded-card border border-sand bg-surface p-5 md:grid-cols-4 md:items-end"
          key={result && "invite" in result ? result.invite : "f"}
        >
          <input type="hidden" name="_csrf" value={csrf} />
          <input type="hidden" name="intent" value="invite" />
          <Field label={a.staff.email} name="email" type="email" dir="ltr" />
          <label className="block text-sm font-medium">
            {a.staff.role}
            <select name="roleKey" className={inputCls}>
              {roleKeys.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            {a.staff.branch}
            <select name="branchId" className={inputCls}>
              <option value="">{a.staff.allBranches}</option>
              {brs.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <SubmitButton>{a.staff.create}</SubmitButton>
        </Form>
      ) : null}
    </div>
  );
}
