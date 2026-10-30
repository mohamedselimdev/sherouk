import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditEntries } from "../../db/schema";
import { ForbiddenError, loadPrincipal } from "../../server/auth/rbac";
import { createOrder, markOrderPaid } from "../../server/orders/service";
import {
  csvCell,
  financeSummary,
  ledgerCsv,
  listAudit,
  listCustomers,
  toCsv,
} from "../../server/reporting/finance";
import { closeDb, db, makeStaff, reset } from "./helpers";
import { deliveryOrder, makeOnlineBranch, makeVariant, rate, stock } from "./commerce-helpers";

beforeEach(async () => {
  await reset();
  await rate("cairo", 7000);
});
afterAll(closeDb);

describe("csv", () => {
  it("quotes cells and neutralises spreadsheet formulas", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell('=HYPERLINK("http://evil")')).toBe('"\'=HYPERLINK(""http://evil"")"');
    for (const bad of ["+1", "-1", "@SUM(A1)", "\tcmd"])
      expect(csvCell(bad).replace(/^"/, "").startsWith("'")).toBe(true);
    expect(csvCell(12.5)).toBe("12.5");
    expect(
      toCsv([
        ["a", "b"],
        [1, "c,d"],
      ]),
    ).toBe('a,b\r\n1,"c,d"\r\n');
  });
});

describe("finance, audit and customers need their own permissions", () => {
  async function paid() {
    const branch = await makeOnlineBranch("main");
    const variant = await makeVariant(100000);
    await stock(branch, variant, 5);
    const o = await createOrder(db, deliveryOrder(variant, 1), { allowCod: false });
    await markOrderPaid(db, o.ref, { type: "provider", providerRef: "tx-fin-1" });
    return o;
  }

  it("finance sees the ledger summary and exports a CSV, and the export is audited", async () => {
    const o = await paid();
    const finance = await loadPrincipal(db, await makeStaff("fin@shrouk.test", "finance"));
    const s = await financeSummary(db, finance, 30);
    expect(s).toMatchObject({
      collectedPiasters: o.totalPiasters,
      refundedPiasters: 0,
      netPiasters: o.totalPiasters,
    });
    expect(s.byMethod).toEqual([{ method: "online", collectedPiasters: o.totalPiasters, orders: 1 }]);
    const csv = await ledgerCsv(db, finance, 30);
    expect(csv.split("\r\n")[0]).toBe("date_cairo,order,type,method,amount_egp,reference");
    expect(csv).toContain(`${o.ref},charge,online,1070.00,tx-fin-1`);
    const log = await db.select().from(auditEntries).where(eq(auditEntries.action, "finance.export"));
    expect(log).toHaveLength(1);
  });

  it("other roles are refused", async () => {
    await paid();
    for (const role of ["marketing", "customer_support", "content_editor", "inventory_staff"]) {
      const p = await loadPrincipal(db, await makeStaff(`${role}@shrouk.test`, role));
      await expect(financeSummary(db, p)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(ledgerCsv(db, p)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("the audit log is readable only with audit:read and filters by action prefix without wildcards", async () => {
    await paid();
    const hq = await loadPrincipal(db, await makeStaff("hq@shrouk.test", "hq_admin"));
    const support = await loadPrincipal(db, await makeStaff("sup@shrouk.test", "customer_support"));
    await expect(listAudit(db, support)).rejects.toBeInstanceOf(ForbiddenError);
    await ledgerCsv(db, await loadPrincipal(db, await makeStaff("fin@shrouk.test", "finance")), 7);
    const rows = await listAudit(db, hq, { actionPrefix: "finance." });
    expect(rows.map((r) => r.action)).toEqual(["finance.export"]);
    expect(rows[0]!.actor).toBe("fin@shrouk.test");
    expect((await listAudit(db, hq, { actionPrefix: "%" })).length).toBeGreaterThan(0); // "%" is stripped, not a wildcard
  });

  it("customer lists need customers:read", async () => {
    const hq = await loadPrincipal(db, await makeStaff("hq@shrouk.test", "hq_admin"));
    const editor = await loadPrincipal(db, await makeStaff("ed@shrouk.test", "content_editor"));
    await expect(listCustomers(db, hq)).resolves.toEqual([]);
    await expect(listCustomers(db, editor)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
