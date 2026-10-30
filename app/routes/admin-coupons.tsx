import { Form, useActionData, useOutletContext } from "react-router";
import { ZodError } from "zod";
import type { Route } from "./+types/admin-coupons";
import type { AdminOutletContext } from "~/layouts/admin";
import { useT } from "~/i18n/context";
import { FormError, FormOk, inputCls } from "~/components/form";
import { btnOutline, btnPrimary } from "~/components/ui";
import { formatEGP } from "~/lib/format";
import { ForbiddenError } from "../../server/auth/rbac";
import { NotFoundError } from "../../server/catalog/admin";
import {
  createCoupon,
  DuplicateCouponError,
  listCoupons,
  setCouponActive,
} from "../../server/promotions/coupons";
import { requireStaff, requireStaffAction } from "../../server/http/session";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { principal, scope } = await requireStaff(request, context, {
    lang: params.lang,
    permission: "coupons:manage",
  });
  return { coupons: await listCoupons(scope.db, principal) };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const { auth, form } = await requireStaffAction(request, context, { lang: params.lang });
  const { scope, principal } = auth;
  try {
    if (form.get("intent") === "toggle") {
      await setCouponActive(
        scope.db,
        principal,
        form.get("id")?.toString() ?? "",
        form.get("active") === "true",
      );
    } else {
      await createCoupon(scope.db, principal, Object.fromEntries(form));
    }
    return { ok: true as const };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "forbidden" as const };
    if (e instanceof DuplicateCouponError) return { error: "duplicate" as const };
    if (e instanceof ZodError || e instanceof NotFoundError) return { error: "invalid" as const };
    throw e;
  }
}

export default function AdminCoupons({ loaderData }: Route.ComponentProps) {
  const { a, lang } = useT();
  const m = a.modules;
  const result = useActionData<typeof action>();
  const { csrf } = useOutletContext<AdminOutletContext>();
  const day = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : "—");
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{m.coupons}</h1>
      <FormError>{result && "error" in result && result.error ? m[result.error] : null}</FormError>
      <FormOk>{result && "ok" in result ? m.saved : null}</FormOk>

      <Form
        method="post"
        className="grid gap-3 rounded-card border border-sand bg-surface p-4 sm:grid-cols-2"
      >
        <input type="hidden" name="_csrf" value={csrf} />
        <label className="grid gap-1 text-sm">
          {m.couponCode}
          <input name="code" required minLength={3} maxLength={32} dir="ltr" className={inputCls} />
        </label>
        <label className="grid gap-1 text-sm">
          {m.couponType}
          <select name="type" className={inputCls} defaultValue="percent">
            <option value="percent">{m.percent}</option>
            <option value="fixed">{m.fixed}</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          {m.couponValue}
          <input name="value" type="number" step="0.01" min="0.01" required className={inputCls} />
        </label>
        <label className="grid gap-1 text-sm">
          {m.minOrder}
          <input name="minSubtotal" type="number" step="0.01" min="0" defaultValue="0" className={inputCls} />
        </label>
        <label className="grid gap-1 text-sm">
          {m.maxDiscount}
          <input name="maxDiscount" type="number" step="0.01" min="0" className={inputCls} />
        </label>
        <label className="grid gap-1 text-sm">
          {m.maxUses}
          <input name="maxRedemptions" type="number" step="1" min="1" className={inputCls} />
        </label>
        <label className="grid gap-1 text-sm">
          {m.startsAt}
          <input name="startsAt" type="date" className={inputCls} />
        </label>
        <label className="grid gap-1 text-sm">
          {m.endsAt}
          <input name="endsAt" type="date" className={inputCls} />
        </label>
        <div className="sm:col-span-2">
          <button type="submit" className={btnPrimary}>
            {m.createCoupon}
          </button>
        </div>
      </Form>

      {loaderData.coupons.length === 0 ? (
        <p className="rounded-card bg-panel p-6 text-center text-muted">{m.empty}</p>
      ) : (
        <ul className="grid gap-2 text-sm">
          {loaderData.coupons.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-input border border-sand bg-surface p-3"
            >
              <span>
                <span className="block font-semibold" dir="ltr">
                  {c.code}
                </span>
                <span className="text-muted">
                  {c.type === "percent" ? `${c.value / 100}%` : formatEGP(c.value, lang)} · {m.used}:{" "}
                  {c.redeemedCount}
                  {c.maxRedemptions ? ` / ${c.maxRedemptions}` : ""} · {day(c.startsAt)} → {day(c.endsAt)}
                </span>
              </span>
              <Form method="post">
                <input type="hidden" name="_csrf" value={csrf} />
                <input type="hidden" name="intent" value="toggle" />
                <input type="hidden" name="id" value={c.id} />
                <input type="hidden" name="active" value={String(!c.active)} />
                <button type="submit" className={btnOutline}>
                  {c.active ? m.disable : m.enable}
                </button>
              </Form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
