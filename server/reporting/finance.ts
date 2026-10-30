import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "../db";
import { auditEntries, customers, ledgerEntries, orders, users } from "../../db/schema";
import { audit } from "../audit";
import { requirePermission, type Principal } from "../auth/rbac";

const TZ_SQL = sql.raw("'Africa/Cairo'");

export type FinanceSummary = {
  rangeDays: number;
  collectedPiasters: number;
  refundedPiasters: number;
  netPiasters: number;
  byType: { type: string; count: number; totalPiasters: number }[];
  byMethod: { method: string; collectedPiasters: number; orders: number }[];
  pendingCodPiasters: number;
};

/** Money figures come only from the ledger (and unpaid COD from orders). Needs `finance:read`. */
export async function financeSummary(db: Db, principal: Principal, days = 30): Promise<FinanceSummary> {
  requirePermission(principal, "finance:read");
  const range = Math.min(Math.max(days, 1), 365);
  const since = new Date(Date.now() - range * 86_400_000);
  const byType = await db
    .select({
      type: ledgerEntries.type,
      count: sql<number>`count(*)::int`,
      total: sql<number>`coalesce(sum(${ledgerEntries.amountPiasters}), 0)::int`,
    })
    .from(ledgerEntries)
    .where(gte(ledgerEntries.createdAt, since))
    .groupBy(ledgerEntries.type);
  const byMethod = await db
    .select({
      method: orders.paymentMethod,
      collected: sql<number>`coalesce(sum(${ledgerEntries.amountPiasters}) filter (where ${ledgerEntries.amountPiasters} > 0), 0)::int`,
      n: sql<number>`count(distinct ${ledgerEntries.orderId})::int`,
    })
    .from(ledgerEntries)
    .innerJoin(orders, eq(orders.id, ledgerEntries.orderId))
    .where(gte(ledgerEntries.createdAt, since))
    .groupBy(orders.paymentMethod);
  const [cod] = await db
    .select({ total: sql<number>`coalesce(sum(${orders.totalPiasters}), 0)::int` })
    .from(orders)
    .where(
      and(
        eq(orders.paymentMethod, "cod"),
        eq(orders.paymentStatus, "awaiting_collection"),
        sql`${orders.status} <> 'cancelled'`,
      ),
    );
  const collected = byType.filter((t) => t.total > 0).reduce((n, t) => n + t.total, 0);
  const refunded = 0 - byType.filter((t) => t.total < 0).reduce((n, t) => n + t.total, 0);
  return {
    rangeDays: range,
    collectedPiasters: collected,
    refundedPiasters: refunded,
    netPiasters: collected - refunded,
    byType: byType.map((t) => ({ type: t.type, count: t.count, totalPiasters: t.total })),
    byMethod: byMethod.map((m) => ({ method: m.method, collectedPiasters: m.collected, orders: m.n })),
    pendingCodPiasters: cod!.total,
  };
}

/** CSV cells that start with a formula character are prefixed so spreadsheets never execute them. */
export function csvCell(value: string | number): string {
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Ledger export for finance. The export itself is audited (who, what range). */
export async function ledgerCsv(db: Db, principal: Principal, days = 30): Promise<string> {
  requirePermission(principal, "finance:read");
  const range = Math.min(Math.max(days, 1), 365);
  const since = new Date(Date.now() - range * 86_400_000);
  const rows = await db
    .select({
      day: sql<string>`to_char(${ledgerEntries.createdAt} at time zone ${TZ_SQL}, 'YYYY-MM-DD HH24:MI')`,
      ref: orders.ref,
      type: ledgerEntries.type,
      amount: ledgerEntries.amountPiasters,
      reference: ledgerEntries.reference,
      method: orders.paymentMethod,
    })
    .from(ledgerEntries)
    .innerJoin(orders, eq(orders.id, ledgerEntries.orderId))
    .where(gte(ledgerEntries.createdAt, since))
    .orderBy(asc(ledgerEntries.createdAt))
    .limit(50_000);
  await audit(db, {
    actorId: principal.userId,
    action: "finance.export",
    detail: `ledger ${range}d ${rows.length} rows`,
  });
  return toCsv([
    ["date_cairo", "order", "type", "method", "amount_egp", "reference"],
    ...rows.map((r) => [r.day, r.ref, r.type, r.method, (r.amount / 100).toFixed(2), r.reference]),
  ]);
}

export async function listAudit(
  db: Db,
  principal: Principal,
  opts: { actionPrefix?: string; limit?: number } = {},
) {
  requirePermission(principal, "audit:read");
  const prefix = (opts.actionPrefix ?? "").replace(/[%_\\]/g, "").slice(0, 40);
  return db
    .select({
      id: auditEntries.id,
      at: auditEntries.createdAt,
      action: auditEntries.action,
      entityType: auditEntries.entityType,
      entityId: auditEntries.entityId,
      detail: auditEntries.detail,
      actor: users.email,
    })
    .from(auditEntries)
    .leftJoin(users, eq(users.id, auditEntries.actorId))
    .where(prefix ? sql`${auditEntries.action} like ${prefix + "%"}` : undefined)
    .orderBy(desc(auditEntries.createdAt))
    .limit(Math.min(opts.limit ?? 100, 500));
}

export async function listCustomers(db: Db, principal: Principal) {
  requirePermission(principal, "customers:read");
  return db
    .select({
      id: customers.id,
      name: customers.name,
      email: customers.email,
      phone: customers.phone,
      createdAt: customers.createdAt,
      orders: sql<number>`(select count(*)::int from orders o where o.customer_id = ${customers.id})`,
    })
    .from(customers)
    .orderBy(desc(customers.createdAt))
    .limit(200);
}
