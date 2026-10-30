import type { Route } from "./+types/admin-finance-csv";
import { ledgerCsv } from "../../server/reporting/finance";
import { requireStaff } from "../../server/http/session";

/** Authenticated download only (finance:read); the export is written to the audit log. */
export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { principal, scope } = await requireStaff(request, context, {
    lang: params.lang,
    permission: "finance:read",
  });
  const days = Number(new URL(request.url).searchParams.get("days")) || 30;
  const csv = await ledgerCsv(scope.db, principal, days);
  return new Response("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="shrouk-ledger-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
