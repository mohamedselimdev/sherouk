import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db";
import { branchHours, branchTranslations, branches } from "../../db/schema";
import { audit } from "../audit";
import { requirePermission, visibleBranches, type Principal } from "../auth/rbac";
import { NotFoundError } from "../catalog/admin";

const translation = z.object({
  name: z.string().trim().min(1).max(120),
  city: z.string().trim().min(1).max(80),
  address: z.string().trim().min(1).max(300),
});

export const branchInput = z.object({
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(60),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ]{7,20}$/)
    .nullish(),
  email: z.email().nullish(),
  offersExams: z.boolean().default(false),
  pickupEnabled: z.boolean().default(false),
  ar: translation,
  en: translation,
});

/** Only the branches the principal may read: every branch for company-wide roles, otherwise their own. */
export async function listBranches(db: Db, principal: Principal) {
  const scope = visibleBranches(principal, "branches:read");
  if (Array.isArray(scope) && scope.length === 0) return [];
  const rows = await db
    .select({
      id: branches.id,
      slug: branches.slug,
      verified: branches.verified,
      phone: branches.phone,
      pickupEnabled: branches.pickupEnabled,
      offersExams: branches.offersExams,
      name: branchTranslations.name,
      locale: branchTranslations.locale,
    })
    .from(branches)
    .innerJoin(branchTranslations, eq(branchTranslations.branchId, branches.id))
    .where(scope === "all" ? undefined : inArray(branches.id, scope));
  return rows;
}

export async function createBranch(db: Db, principal: Principal, raw: unknown): Promise<{ id: string }> {
  requirePermission(principal, "branches:write", null);
  const input = branchInput.parse(raw);
  return db.transaction(async (tx) => {
    const [b] = await tx
      .insert(branches)
      .values({
        slug: input.slug,
        phone: input.phone ?? null,
        email: input.email ?? null,
        offersExams: input.offersExams,
        pickupEnabled: input.pickupEnabled,
      })
      .returning({ id: branches.id });
    await tx.insert(branchTranslations).values([
      { branchId: b!.id, locale: "ar", ...input.ar },
      { branchId: b!.id, locale: "en", ...input.en },
    ]);
    await audit(tx, {
      actorId: principal.userId,
      action: "branch.created",
      entityType: "branch",
      entityId: b!.id,
      branchId: b!.id,
    });
    return { id: b!.id };
  });
}

const contactPatch = z.object({
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ]{7,20}$/)
    .nullish(),
  pickupEnabled: z.boolean().optional(),
  offersExams: z.boolean().optional(),
});

/** Branch-scoped write: a branch manager can only touch the branch their assignment names. */
export async function updateBranchContact(
  db: Db,
  principal: Principal,
  branchId: string,
  raw: unknown,
): Promise<void> {
  requirePermission(principal, "branches:write", branchId);
  const patch = contactPatch.parse(raw);
  const [row] = await db
    .update(branches)
    .set(patch)
    .where(eq(branches.id, branchId))
    .returning({ id: branches.id });
  if (!row) throw new NotFoundError("Branch not found");
  await audit(db, {
    actorId: principal.userId,
    action: "branch.updated",
    entityType: "branch",
    entityId: branchId,
    branchId,
  });
}

const hoursInput = z
  .array(
    z.object({
      weekday: z.number().int().min(0).max(6),
      opensAt: z
        .string()
        .regex(/^\d{2}:\d{2}$/)
        .nullable(),
      closesAt: z
        .string()
        .regex(/^\d{2}:\d{2}$/)
        .nullable(),
      closed: z.boolean(),
    }),
  )
  .max(7);

export async function setBranchHours(
  db: Db,
  principal: Principal,
  branchId: string,
  raw: unknown,
): Promise<void> {
  requirePermission(principal, "branches:write", branchId);
  const hours = hoursInput.parse(raw);
  await db.transaction(async (tx) => {
    await tx.delete(branchHours).where(eq(branchHours.branchId, branchId));
    if (hours.length) await tx.insert(branchHours).values(hours.map((h) => ({ branchId, ...h })));
    await audit(tx, {
      actorId: principal.userId,
      action: "branch.hours_updated",
      entityType: "branch",
      entityId: branchId,
      branchId,
    });
  });
}

export type BranchDetail = {
  id: string;
  slug: string;
  name: string;
  verified: boolean;
  phone: string | null;
  pickupEnabled: boolean;
  offersExams: boolean;
  hours: { weekday: number; opensAt: string | null; closesAt: string | null; closed: boolean }[];
};

/** Branches the principal may read, with their opening hours. */
export async function listBranchDetails(
  db: Db,
  principal: Principal,
  locale: "ar" | "en",
): Promise<BranchDetail[]> {
  const scope = visibleBranches(principal, "branches:read");
  if (Array.isArray(scope) && scope.length === 0) return [];
  const rows = await db
    .select({
      id: branches.id,
      slug: branches.slug,
      verified: branches.verified,
      phone: branches.phone,
      pickupEnabled: branches.pickupEnabled,
      offersExams: branches.offersExams,
      name: branchTranslations.name,
    })
    .from(branches)
    .leftJoin(
      branchTranslations,
      and(eq(branchTranslations.branchId, branches.id), eq(branchTranslations.locale, locale)),
    )
    .where(scope === "all" ? undefined : inArray(branches.id, scope))
    .orderBy(asc(branches.slug));
  const hours = rows.length
    ? await db
        .select()
        .from(branchHours)
        .where(
          inArray(
            branchHours.branchId,
            rows.map((r) => r.id),
          ),
        )
    : [];
  return rows.map((r) => ({
    ...r,
    name: r.name ?? r.slug,
    hours: hours
      .filter((h) => h.branchId === r.id)
      .sort((a, b) => a.weekday - b.weekday)
      .map((h) => ({
        weekday: h.weekday,
        opensAt: h.opensAt?.slice(0, 5) ?? null,
        closesAt: h.closesAt?.slice(0, 5) ?? null,
        closed: h.closed,
      })),
  }));
}
