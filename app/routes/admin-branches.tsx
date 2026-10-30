import { Form, useActionData, useOutletContext } from "react-router";
import { ZodError } from "zod";
import type { Route } from "./+types/admin-branches";
import type { AdminOutletContext } from "~/layouts/admin";
import { useT } from "~/i18n/context";
import { FormError, FormOk, inputCls } from "~/components/form";
import { btnPrimary } from "~/components/ui";
import { ForbiddenError } from "../../server/auth/rbac";
import { listBranchDetails, setBranchHours, updateBranchContact } from "../../server/branches/service";
import { requireStaff, requireStaffAction } from "../../server/http/session";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { principal, scope } = await requireStaff(request, context, {
    lang: params.lang,
    permission: "branches:read",
    anyScope: true,
  });
  return { branches: await listBranchDetails(scope.db, principal, params.lang === "en" ? "en" : "ar") };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const { auth, form } = await requireStaffAction(request, context, { lang: params.lang, anyScope: true });
  const { scope, principal } = auth;
  const branchId = form.get("branchId")?.toString() ?? "";
  try {
    await updateBranchContact(scope.db, principal, branchId, {
      phone: form.get("phone")?.toString().trim() || null,
      pickupEnabled: form.get("pickupEnabled") === "on",
      offersExams: form.get("offersExams") === "on",
    });
    const hours = Array.from({ length: 7 }, (_, weekday) => {
      const closed = form.get(`closed_${weekday}`) === "on";
      return {
        weekday,
        closed,
        opensAt: closed ? null : form.get(`open_${weekday}`)?.toString() || null,
        closesAt: closed ? null : form.get(`close_${weekday}`)?.toString() || null,
      };
    });
    await setBranchHours(scope.db, principal, branchId, hours);
    return { ok: true as const };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "forbidden" as const };
    if (e instanceof ZodError) return { error: "invalid" as const };
    throw e;
  }
}

export default function AdminBranches({ loaderData }: Route.ComponentProps) {
  const { a } = useT();
  const m = a.modules;
  const result = useActionData<typeof action>();
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{m.branches}</h1>
      <FormError>{result?.error ? m[result.error] : null}</FormError>
      <FormOk>{result?.ok ? m.saved : null}</FormOk>
      {loaderData.branches.length === 0 ? (
        <p className="rounded-card bg-panel p-6 text-center text-muted">{m.empty}</p>
      ) : (
        <ul className="grid gap-4">
          {loaderData.branches.map((b) => (
            <li key={b.id} className="rounded-card border border-sand bg-surface p-4">
              <BranchForm branch={b} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BranchForm({ branch: b }: { branch: Route.ComponentProps["loaderData"]["branches"][number] }) {
  const { a } = useT();
  const m = a.modules;
  const { csrf } = useOutletContext<AdminOutletContext>();
  const hourFor = (d: number) => b.hours.find((h) => h.weekday === d);
  return (
    <Form method="post" className="grid gap-3">
      <input type="hidden" name="_csrf" value={csrf} />
      <input type="hidden" name="branchId" value={b.id} />
      <p className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-lg font-bold">{b.name}</span>
        <span className="rounded bg-panel px-2 py-0.5 text-xs text-muted">
          {b.verified ? m.verified : m.unverified}
        </span>
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          {m.branchPhone}
          <input name="phone" defaultValue={b.phone ?? ""} dir="ltr" className={inputCls} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="pickupEnabled"
            defaultChecked={b.pickupEnabled}
            className="size-4 accent-[var(--cta)]"
          />
          {m.pickup}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="offersExams"
            defaultChecked={b.offersExams}
            className="size-4 accent-[var(--cta)]"
          />
          {m.exams}
        </label>
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-1 font-semibold">{m.hours}</legend>
        {m.days.map((day, d) => {
          const h = hourFor(d);
          return (
            <div key={day} className="grid grid-cols-[6rem_1fr_1fr_auto] items-center gap-2 text-sm">
              <span>{day}</span>
              <input
                type="time"
                name={`open_${d}`}
                aria-label={`${day} ${m.opens}`}
                defaultValue={h?.opensAt ?? ""}
                className={`${inputCls} !mt-0`}
              />
              <input
                type="time"
                name={`close_${d}`}
                aria-label={`${day} ${m.closes}`}
                defaultValue={h?.closesAt ?? ""}
                className={`${inputCls} !mt-0`}
              />
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  name={`closed_${d}`}
                  defaultChecked={h?.closed ?? false}
                  className="size-4 accent-[var(--cta)]"
                />
                {m.closed}
              </label>
            </div>
          );
        })}
      </fieldset>
      <div>
        <button type="submit" className={btnPrimary}>
          {m.save}
        </button>
      </div>
    </Form>
  );
}
