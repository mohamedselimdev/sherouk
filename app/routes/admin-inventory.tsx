import { Form, useActionData, useOutletContext } from "react-router";
import { ZodError } from "zod";
import type { Route } from "./+types/admin-inventory";
import type { AdminOutletContext } from "~/layouts/admin";
import { useT } from "~/i18n/context";
import { FormError, FormOk, inputCls } from "~/components/form";
import { btnPrimary } from "~/components/ui";
import { ForbiddenError } from "../../server/auth/rbac";
import { adjustStock, listInventory, NegativeStockError } from "../../server/inventory/service";
import { requireStaff, requireStaffAction } from "../../server/http/session";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { principal, scope } = await requireStaff(request, context, {
    lang: params.lang,
    permission: "inventory:read",
    anyScope: true,
  });
  return { rows: await listInventory(scope.db, principal, params.lang === "en" ? "en" : "ar") };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const { auth, form } = await requireStaffAction(request, context, { lang: params.lang, anyScope: true });
  try {
    await adjustStock(auth.scope.db, auth.principal, {
      branchId: form.get("branchId")?.toString(),
      variantId: form.get("variantId")?.toString(),
      delta: Number(form.get("delta")?.toString() ?? ""),
      type: form.get("type")?.toString() === "receipt" ? "receipt" : "adjustment",
      reason: form.get("reason")?.toString() ?? "",
    });
    return { ok: true as const };
  } catch (e) {
    if (e instanceof ZodError) return { error: "errInvalid" as const };
    if (e instanceof NegativeStockError) return { error: "errNegative" as const };
    if (e instanceof ForbiddenError) return { error: "errForbidden" as const };
    throw e;
  }
}

export default function AdminInventory({ loaderData }: Route.ComponentProps) {
  const { a } = useT();
  const { csrf, caps } = useOutletContext<AdminOutletContext>();
  const result = useActionData<typeof action>();
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{a.inventory.title}</h1>
      <FormError>{result?.error ? a.inventory[result.error] : null}</FormError>
      <FormOk>{result?.ok ? a.inventory.saved : null}</FormOk>
      {loaderData.rows.length === 0 ? (
        <p className="rounded-card bg-panel p-8 text-center text-muted">{a.inventory.none}</p>
      ) : (
        <ul className="grid gap-3">
          {loaderData.rows.map((r) => (
            <li
              key={`${r.branchId}-${r.variantId}`}
              className="rounded-card border border-sand bg-surface p-4 text-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>
                  <span className="block font-semibold">{r.productName}</span>
                  <span className="text-muted" dir="ltr">
                    {r.sku}
                  </span>{" "}
                  · <span className="text-muted">{r.branchName}</span>
                </span>
                <span>
                  {a.inventory.onHand}: <strong>{r.onHand}</strong> · {a.inventory.reserved}:{" "}
                  <strong>{r.reserved}</strong> · {a.inventory.available}: <strong>{r.available}</strong>
                  {r.low ? (
                    <span className="ms-2 rounded bg-cta/15 px-2 py-0.5 text-xs text-cta">
                      {a.inventory.low}
                    </span>
                  ) : null}
                </span>
              </div>
              {caps.inventoryWrite ? (
                <Form
                  method="post"
                  className="mt-3 grid gap-2 sm:grid-cols-[6rem_1fr_9rem_auto] sm:items-end"
                >
                  <input type="hidden" name="_csrf" value={csrf} />
                  <input type="hidden" name="branchId" value={r.branchId} />
                  <input type="hidden" name="variantId" value={r.variantId} />
                  <label className="text-xs">
                    {a.inventory.delta}
                    <input name="delta" type="number" required step={1} className={inputCls} dir="ltr" />
                  </label>
                  <label className="text-xs">
                    {a.inventory.reason}
                    <input name="reason" required minLength={3} maxLength={200} className={inputCls} />
                  </label>
                  <select name="type" aria-label={a.inventory.adjust} className={`${inputCls} !mt-0`}>
                    <option value="adjustment">{a.inventory.adjustment}</option>
                    <option value="receipt">{a.inventory.receipt}</option>
                  </select>
                  <button type="submit" className={btnPrimary}>
                    {a.inventory.apply}
                  </button>
                </Form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
