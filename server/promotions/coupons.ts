import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db";
import { coupons } from "../../db/schema";
import { audit } from "../audit";
import { requirePermission, type Principal } from "../auth/rbac";
import { NotFoundError } from "../catalog/admin";

export class DuplicateCouponError extends Error {
  constructor() {
    super("Coupon code already exists");
    this.name = "DuplicateCouponError";
  }
}

const optionalDate = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : new Date(v)))
  .refine((d) => d === null || !Number.isNaN(d.getTime()), "invalid date");

/** Values arrive in the units admins type: percent as 0-100 and money in EGP. */
const couponInput = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_-]{3,32}$/),
    type: z.enum(["percent", "fixed"]),
    value: z.coerce.number().positive().max(1_000_000),
    minSubtotal: z.coerce.number().min(0).max(10_000_000).default(0),
    maxDiscount: z.union([z.literal(""), z.coerce.number().positive().max(10_000_000)]).default(""),
    maxRedemptions: z.union([z.literal(""), z.coerce.number().int().positive().max(1_000_000)]).default(""),
    startsAt: optionalDate.default(null),
    endsAt: optionalDate.default(null),
  })
  .refine((c) => c.type !== "percent" || c.value <= 100, { path: ["value"], message: "percent over 100" })
  .refine((c) => !c.startsAt || !c.endsAt || c.endsAt > c.startsAt, {
    path: ["endsAt"],
    message: "ends before start",
  });

const toPiasters = (egp: number) => Math.round(egp * 100);

function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } };
  return err.code === "23505" || err.cause?.code === "23505";
}

export async function listCoupons(db: Db, principal: Principal) {
  requirePermission(principal, "coupons:manage", null);
  return db.select().from(coupons).orderBy(desc(coupons.createdAt));
}

export async function createCoupon(db: Db, principal: Principal, raw: unknown) {
  requirePermission(principal, "coupons:manage", null);
  const c = couponInput.parse(raw);
  try {
    const [row] = await db
      .insert(coupons)
      .values({
        code: c.code,
        type: c.type,
        value: c.type === "percent" ? Math.round(c.value * 100) : toPiasters(c.value),
        minSubtotalPiasters: toPiasters(c.minSubtotal),
        maxDiscountPiasters: c.maxDiscount === "" ? null : toPiasters(c.maxDiscount),
        maxRedemptions: c.maxRedemptions === "" ? null : c.maxRedemptions,
        startsAt: c.startsAt,
        endsAt: c.endsAt,
      })
      .returning({ id: coupons.id });
    await audit(db, {
      actorId: principal.userId,
      action: "coupon.created",
      entityType: "coupon",
      entityId: row!.id,
      detail: c.code,
    });
    return row!.id;
  } catch (e) {
    if (isUniqueViolation(e)) throw new DuplicateCouponError();
    throw e;
  }
}

export async function setCouponActive(db: Db, principal: Principal, id: string, active: boolean) {
  requirePermission(principal, "coupons:manage", null);
  const [row] = await db
    .update(coupons)
    .set({ active })
    .where(eq(coupons.id, id))
    .returning({ code: coupons.code });
  if (!row) throw new NotFoundError("Coupon not found");
  await audit(db, {
    actorId: principal.userId,
    action: active ? "coupon.enabled" : "coupon.disabled",
    entityType: "coupon",
    entityId: id,
    detail: row.code,
  });
}
