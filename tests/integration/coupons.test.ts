import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { eq } from "drizzle-orm";
import { auditEntries } from "../../db/schema";
import { ForbiddenError, loadPrincipal } from "../../server/auth/rbac";
import {
  createCoupon,
  DuplicateCouponError,
  listCoupons,
  setCouponActive,
} from "../../server/promotions/coupons";
import { closeDb, db, makeStaff, reset } from "./helpers";

beforeEach(reset);
afterAll(closeDb);

const marketing = async () => loadPrincipal(db, await makeStaff("mk@shrouk.test", "marketing"));

describe("coupon administration", () => {
  it("is refused for roles without coupons:manage", async () => {
    const support = await loadPrincipal(db, await makeStaff("sup@shrouk.test", "customer_support"));
    await expect(listCoupons(db, support)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      createCoupon(db, support, { code: "NOPE10", type: "percent", value: "10" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("stores percent as basis points and money as piasters, with the code upper-cased", async () => {
    const p = await marketing();
    await createCoupon(db, p, {
      code: " ramadan10 ",
      type: "percent",
      value: "12.5",
      minSubtotal: "500",
      maxDiscount: "150.50",
      maxRedemptions: "100",
      startsAt: "",
      endsAt: "2027-01-31",
    });
    await createCoupon(db, p, { code: "FLAT50", type: "fixed", value: "50" });
    const rows = await listCoupons(db, p);
    const ramadan = rows.find((r) => r.code === "RAMADAN10")!;
    expect(ramadan).toMatchObject({
      type: "percent",
      value: 1250,
      minSubtotalPiasters: 50000,
      maxDiscountPiasters: 15050,
      maxRedemptions: 100,
      active: true,
    });
    expect(ramadan.endsAt).toBeInstanceOf(Date);
    expect(rows.find((r) => r.code === "FLAT50")).toMatchObject({
      type: "fixed",
      value: 5000,
      maxRedemptions: null,
    });
  });

  it("rejects invalid input", async () => {
    const p = await marketing();
    for (const bad of [
      { code: "ab", type: "percent", value: "10" },
      { code: "OVER", type: "percent", value: "101" },
      { code: "ZERO", type: "fixed", value: "0" },
      { code: "BADTYPE", type: "bogo", value: "5" },
      { code: "BACKWARDS", type: "fixed", value: "5", startsAt: "2027-02-01", endsAt: "2027-01-01" },
      { code: "BAD DATE", type: "fixed", value: "5" },
      { code: "NODATE", type: "fixed", value: "5", endsAt: "not-a-date" },
    ]) {
      await expect(createCoupon(db, p, bad)).rejects.toBeInstanceOf(ZodError);
    }
    expect(await listCoupons(db, p)).toHaveLength(0);
  });

  it("refuses a duplicate code regardless of case", async () => {
    const p = await marketing();
    await createCoupon(db, p, { code: "ONCE", type: "fixed", value: "10" });
    await expect(createCoupon(db, p, { code: "once", type: "fixed", value: "20" })).rejects.toBeInstanceOf(
      DuplicateCouponError,
    );
  });

  it("disables and re-enables, and audits each change", async () => {
    const p = await marketing();
    const id = await createCoupon(db, p, { code: "TOGGLE", type: "fixed", value: "10" });
    await setCouponActive(db, p, id, false);
    expect((await listCoupons(db, p))[0]!.active).toBe(false);
    await setCouponActive(db, p, id, true);
    expect((await listCoupons(db, p))[0]!.active).toBe(true);
    const actions = (await db.select().from(auditEntries).where(eq(auditEntries.entityId, id))).map(
      (e) => e.action,
    );
    expect(actions.sort()).toEqual(["coupon.created", "coupon.disabled", "coupon.enabled"]);
  });
});
