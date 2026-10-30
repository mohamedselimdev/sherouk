import type { Db, Tx } from "./db";
import { auditEntries } from "../db/schema";

export type AuditInput = {
  actorId: string | null;
  actorType?: "staff" | "customer" | "system";
  action: string;
  entityType?: string;
  entityId?: string;
  branchId?: string | null;
  /** Keep it short and free of secrets or personal data. */
  detail?: string;
  correlationId?: string;
};

export async function audit(db: Db | Tx, entry: AuditInput): Promise<void> {
  await db.insert(auditEntries).values({
    actorId: entry.actorId,
    actorType: entry.actorType ?? "staff",
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    branchId: entry.branchId ?? null,
    detail: entry.detail?.slice(0, 500),
    correlationId: entry.correlationId,
  });
}
