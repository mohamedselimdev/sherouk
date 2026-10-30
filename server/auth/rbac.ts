import { eq } from "drizzle-orm";
import type { Db } from "../db";
import { permissions, rolePermissions, roleAssignments, roles } from "../../db/schema";

/** Deny by default: an action is allowed only when a grant names exactly that permission. */
export const PERMISSIONS = {
  "catalog:read": "View catalog in admin",
  "catalog:write": "Create and edit products, variants",
  "catalog:publish": "Publish and archive products",
  "catalog:price": "Change prices",
  "media:upload": "Upload product media",
  "branches:read": "View branches",
  "branches:write": "Edit branch details and hours",
  "staff:read": "View staff and roles",
  "staff:manage": "Invite, deactivate staff and assign roles",
  "audit:read": "View the audit log",
  "orders:read": "View orders",
  "orders:manage": "Manage orders",
  "refunds:request": "Request a refund",
  "refunds:approve": "Approve and execute refunds",
  "inventory:read": "View inventory",
  "inventory:write": "Adjust stock",
  "customers:read": "View customers",
  "content:write": "Edit CMS content",
  "coupons:manage": "Create, enable and disable coupons",
  "finance:read": "View finance reports",
} as const;
export type Permission = keyof typeof PERMISSIONS;

type RoleDef = { name: string; permissions: Permission[] };

/** System roles. Per-branch scoping comes from the assignment, not from the role. */
export const ROLE_DEFS: Record<string, RoleDef> = {
  hq_admin: { name: "HQ Admin", permissions: Object.keys(PERMISSIONS) as Permission[] },
  operations_manager: {
    name: "Operations Manager",
    permissions: [
      "catalog:read",
      "catalog:write",
      "catalog:publish",
      "catalog:price",
      "media:upload",
      "branches:read",
      "branches:write",
      "orders:read",
      "orders:manage",
      "refunds:request",
      "inventory:read",
      "inventory:write",
      "customers:read",
      "audit:read",
    ],
  },
  marketing: {
    name: "Marketing",
    permissions: ["catalog:read", "media:upload", "content:write", "coupons:manage", "customers:read"],
  },
  finance: {
    name: "Finance",
    permissions: ["orders:read", "refunds:approve", "finance:read", "customers:read", "audit:read"],
  },
  branch_manager: {
    name: "Branch Manager",
    permissions: [
      "branches:read",
      "branches:write",
      "orders:read",
      "orders:manage",
      "inventory:read",
      "inventory:write",
      "customers:read",
    ],
  },
  inventory_staff: {
    name: "Inventory Staff",
    permissions: ["inventory:read", "inventory:write", "branches:read"],
  },
  customer_support: {
    name: "Customer Support",
    permissions: ["orders:read", "refunds:request", "customers:read"],
  },
  content_editor: { name: "Content Editor", permissions: ["catalog:read", "media:upload", "content:write"] },
};

export type Grant = { permission: Permission; branchId: string | null };
export type Principal = { userId: string; grants: Grant[] };

export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export async function loadPrincipal(db: Db, userId: string): Promise<Principal> {
  const rows = await db
    .select({ permission: rolePermissions.permissionKey, branchId: roleAssignments.branchId })
    .from(roleAssignments)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roleAssignments.roleId))
    .where(eq(roleAssignments.userId, userId));
  return {
    userId,
    grants: rows.map((r) => ({ permission: r.permission as Permission, branchId: r.branchId })),
  };
}

/**
 * `resourceBranchId === null` means a company-wide resource (e.g. the catalog): only a grant with no branch
 * scope qualifies. A branch resource is allowed by a company-wide grant or a grant for that exact branch.
 */
export function can(
  principal: Principal,
  permission: Permission,
  resourceBranchId: string | null = null,
): boolean {
  return principal.grants.some(
    (g) =>
      g.permission === permission &&
      (g.branchId === null || (resourceBranchId !== null && g.branchId === resourceBranchId)),
  );
}

/**
 * True when the principal holds the permission for at least one scope (company-wide or any branch).
 * Opens branch-aware screens; the services behind them still filter and authorise per branch.
 */
export function canAny(principal: Principal, permission: Permission): boolean {
  return principal.grants.some((g) => g.permission === permission);
}

export function requirePermission(
  principal: Principal,
  permission: Permission,
  resourceBranchId: string | null = null,
): void {
  if (!can(principal, permission, resourceBranchId))
    throw new ForbiddenError(`Missing permission ${permission}`);
}

/** For list queries: every branch, or just the ones the principal holds `permission` for. */
export function visibleBranches(principal: Principal, permission: Permission): "all" | string[] {
  const grants = principal.grants.filter((g) => g.permission === permission);
  if (grants.some((g) => g.branchId === null)) return "all";
  return [...new Set(grants.map((g) => g.branchId!))];
}

/** Idempotent: makes the permissions and system roles in code the source of truth in the database. */
export async function syncRolesAndPermissions(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    for (const [key, description] of Object.entries(PERMISSIONS)) {
      await tx
        .insert(permissions)
        .values({ key, description })
        .onConflictDoUpdate({ target: permissions.key, set: { description } });
    }
    for (const [key, def] of Object.entries(ROLE_DEFS)) {
      const [role] = await tx
        .insert(roles)
        .values({ key, name: def.name, system: true })
        .onConflictDoUpdate({ target: roles.key, set: { name: def.name } })
        .returning({ id: roles.id });
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, role!.id));
      await tx
        .insert(rolePermissions)
        .values(def.permissions.map((permissionKey) => ({ roleId: role!.id, permissionKey })));
    }
  });
}
