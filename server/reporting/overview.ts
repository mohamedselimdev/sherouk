import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db } from "../db";
import {
  branches,
  branchInventory,
  branchTranslations,
  customers,
  ledgerEntries,
  orderLines,
  orders,
  productTranslations,
  productVariants,
} from "../../db/schema";
import { can, visibleBranches, type Principal } from "../auth/rbac";

const TZ = "Africa/Cairo";
/** Inlined (a constant, not user input): a bound parameter makes the SELECT and GROUP BY expressions differ. */
const TZ_SQL = sql.raw("'Africa/Cairo'");

export type Overview = {
  rangeDays: number;
  generatedAt: Date;
  /** Everything here is the online channel only; in-store sales appear once a POS source is connected. */
  coverage: "online";
  kpis: {
    netRevenuePiasters: number;
    grossPiasters: number;
    refundsPiasters: number;
    orders: number;
    paidOrders: number;
    averageOrderPiasters: number;
    unitsSold: number;
    newCustomers: number | null;
  };
  series: { day: string; orders: number; revenuePiasters: number }[];
  topProducts: { sku: string; name: string; units: number; revenuePiasters: number }[];
  branches: { branchId: string; name: string; orders: number; revenuePiasters: number }[];
  recentOrders: {
    ref: string;
    contactName: string;
    totalPiasters: number;
    status: string;
    paymentStatus: string;
    createdAt: Date;
  }[];
  lowStock: { sku: string; name: string; branch: string; available: number }[];
  needsAttention: number;
};

type Scope = "all" | string[];

function orderScope(scope: Scope) {
  return scope === "all" ? undefined : inArray(orders.branchId, scope);
}

/**
 * Real figures for the executive overview, straight from the database and limited to the branches the viewer may read.
 * Revenue comes from the financial ledger (charges and collected cash minus refunds), not from order totals.
 * Days are bucketed in Africa/Cairo time. Conversion is intentionally absent: it needs analytics data we do not collect yet.
 */
export async function overview(
  db: Db,
  principal: Principal,
  opts: { days?: number; locale?: "ar" | "en" } = {},
): Promise<Overview | null> {
  const scope = visibleBranches(principal, "orders:read");
  if (Array.isArray(scope) && scope.length === 0) return null;
  const days = Math.min(Math.max(opts.days ?? 30, 1), 365);
  const locale = opts.locale ?? "ar";
  const since = new Date(Date.now() - days * 86_400_000);
  const inScope = orderScope(scope);

  const [money] = await db
    .select({
      gross: sql<number>`coalesce(sum(case when ${ledgerEntries.amountPiasters} > 0 then ${ledgerEntries.amountPiasters} end), 0)::int`,
      refunds: sql<number>`coalesce(-sum(case when ${ledgerEntries.amountPiasters} < 0 then ${ledgerEntries.amountPiasters} end), 0)::int`,
      paidOrders: sql<number>`count(distinct case when ${ledgerEntries.amountPiasters} > 0 then ${ledgerEntries.orderId} end)::int`,
    })
    .from(ledgerEntries)
    .innerJoin(orders, eq(orders.id, ledgerEntries.orderId))
    .where(and(gte(ledgerEntries.createdAt, since), inScope));

  const [counts] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(orders)
    .where(and(gte(orders.createdAt, since), sql`${orders.status} <> 'cancelled'`, inScope));

  const [units] = await db
    .select({ n: sql<number>`coalesce(sum(${orderLines.quantity}), 0)::int` })
    .from(orderLines)
    .innerJoin(orders, eq(orders.id, orderLines.orderId))
    .where(
      and(
        gte(orders.createdAt, since),
        inArray(orders.status, ["confirmed", "processing", "completed"]),
        inScope,
      ),
    );

  const dayExpr = sql<string>`to_char(date_trunc('day', ${orders.createdAt} at time zone ${TZ_SQL}), 'YYYY-MM-DD')`;
  const ordersByDay = await db
    .select({ day: dayExpr, n: sql<number>`count(*)::int` })
    .from(orders)
    .where(and(gte(orders.createdAt, since), sql`${orders.status} <> 'cancelled'`, inScope))
    .groupBy(dayExpr);
  const ledgerDay = sql<string>`to_char(date_trunc('day', ${ledgerEntries.createdAt} at time zone ${TZ_SQL}), 'YYYY-MM-DD')`;
  const revenueByDay = await db
    .select({ day: ledgerDay, v: sql<number>`coalesce(sum(${ledgerEntries.amountPiasters}), 0)::int` })
    .from(ledgerEntries)
    .innerJoin(orders, eq(orders.id, ledgerEntries.orderId))
    .where(and(gte(ledgerEntries.createdAt, since), inScope))
    .groupBy(ledgerDay);
  const series: Overview["series"] = [];
  const todayCairo = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  for (let i = days - 1; i >= 0; i--) {
    // Step by calendar days from today's Cairo date: subtracting 24 h can repeat or skip a local date around DST changes.
    const [ty, tm, td] = todayCairo.split("-").map(Number) as [number, number, number];
    const day = new Date(Date.UTC(ty, tm - 1, td - i)).toISOString().slice(0, 10);
    series.push({
      day,
      orders: ordersByDay.find((x) => x.day === day)?.n ?? 0,
      revenuePiasters: revenueByDay.find((x) => x.day === day)?.v ?? 0,
    });
  }

  const top = await db
    .select({
      sku: orderLines.sku,
      title:
        locale === "ar" ? sql<string>`max(${orderLines.titleAr})` : sql<string>`max(${orderLines.titleEn})`,
      units: sql<number>`sum(${orderLines.quantity})::int`,
      revenue: sql<number>`sum(${orderLines.lineTotalPiasters})::int`,
    })
    .from(orderLines)
    .innerJoin(orders, eq(orders.id, orderLines.orderId))
    .where(
      and(
        gte(orders.createdAt, since),
        inArray(orders.status, ["confirmed", "processing", "completed"]),
        inScope,
      ),
    )
    .groupBy(orderLines.sku)
    .orderBy(desc(sql`sum(${orderLines.quantity})`))
    .limit(5);

  const perBranch = await db
    .select({
      branchId: orders.branchId,
      name: sql<string>`coalesce(${branchTranslations.name}, ${branches.slug})`,
      n: sql<number>`count(*)::int`,
      revenue: sql<number>`coalesce(sum(${orders.totalPiasters}) filter (where ${orders.paymentStatus} = 'paid'), 0)::int`,
    })
    .from(orders)
    .innerJoin(branches, eq(branches.id, orders.branchId))
    .leftJoin(
      branchTranslations,
      and(eq(branchTranslations.branchId, orders.branchId), eq(branchTranslations.locale, locale)),
    )
    .where(and(gte(orders.createdAt, since), sql`${orders.status} <> 'cancelled'`, inScope))
    .groupBy(orders.branchId, branchTranslations.name, branches.slug)
    .orderBy(desc(sql`count(*)`));

  const recent = await db
    .select({
      ref: orders.ref,
      contactName: orders.contactName,
      totalPiasters: orders.totalPiasters,
      status: orders.status,
      paymentStatus: orders.paymentStatus,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .where(inScope)
    .orderBy(desc(orders.createdAt))
    .limit(6);

  const invScope = visibleBranches(principal, "inventory:read");
  const low =
    Array.isArray(invScope) && invScope.length === 0
      ? []
      : await db
          .select({
            sku: productVariants.sku,
            name: productTranslations.name,
            branch: sql<string>`coalesce(${branchTranslations.name}, ${branches.slug})`,
            available: sql<number>`(${branchInventory.onHand} - ${branchInventory.reserved})::int`,
          })
          .from(branchInventory)
          .innerJoin(productVariants, eq(productVariants.id, branchInventory.variantId))
          .innerJoin(
            productTranslations,
            and(
              eq(productTranslations.productId, productVariants.productId),
              eq(productTranslations.locale, locale),
            ),
          )
          .innerJoin(branches, eq(branches.id, branchInventory.branchId))
          .leftJoin(
            branchTranslations,
            and(
              eq(branchTranslations.branchId, branchInventory.branchId),
              eq(branchTranslations.locale, locale),
            ),
          )
          .where(
            and(
              sql`${branchInventory.onHand} - ${branchInventory.reserved} <= ${branchInventory.lowStockThreshold}`,
              invScope === "all" ? undefined : inArray(branchInventory.branchId, invScope),
            ),
          )
          .orderBy(sql`${branchInventory.onHand} - ${branchInventory.reserved}`)
          .limit(6);

  const [attention] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(orders)
    .where(and(sql`(${orders.needsRefund} or ${orders.exception} is not null)`, inScope));

  let newCustomers: number | null = null;
  if (can(principal, "customers:read")) {
    const [c] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(customers)
      .where(gte(customers.createdAt, since));
    newCustomers = c!.n;
  }

  const net = money!.gross - money!.refunds;
  return {
    rangeDays: days,
    generatedAt: new Date(),
    coverage: "online",
    kpis: {
      netRevenuePiasters: net,
      grossPiasters: money!.gross,
      refundsPiasters: money!.refunds,
      orders: counts!.n,
      paidOrders: money!.paidOrders,
      averageOrderPiasters: money!.paidOrders ? Math.round(money!.gross / money!.paidOrders) : 0,
      unitsSold: units!.n,
      newCustomers,
    },
    series,
    topProducts: top.map((t) => ({ sku: t.sku, name: t.title, units: t.units, revenuePiasters: t.revenue })),
    branches: perBranch
      .filter((b) => b.branchId)
      .map((b) => ({ branchId: b.branchId!, name: b.name, orders: b.n, revenuePiasters: b.revenue })),
    recentOrders: recent,
    lowStock: low,
    needsAttention: attention!.n,
  };
}
