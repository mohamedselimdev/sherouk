import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db";
import { supportTickets } from "../../db/schema";
import { audit } from "../audit";
import { requirePermission, type Principal } from "../auth/rbac";
import { NotFoundError } from "../catalog/admin";
import { hit } from "../security/throttle";

const blankToNull = (v: string) => (v === "" ? null : v);

const ticketInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: z
      .string()
      .trim()
      .max(254)
      .pipe(z.union([z.literal(""), z.email()]))
      .transform(blankToNull)
      .default(null),
    phone: z
      .string()
      .trim()
      .max(20)
      .pipe(z.union([z.literal(""), z.string().regex(/^[0-9+\s-]{7,20}$/)]))
      .transform(blankToNull)
      .default(null),
    orderRef: z.string().trim().max(32).transform(blankToNull).default(null),
    message: z.string().trim().min(10).max(2000),
    locale: z.enum(["ar", "en"]).default("ar"),
  })
  .refine((t) => t.email !== null || t.phone !== null, {
    path: ["email"],
    message: "email or phone required",
  });

const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function newRef(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return "T-" + Array.from(bytes, (b) => REF_ALPHABET[b % REF_ALPHABET.length]).join("");
}

/** Public submission. At most 5 per address per hour; the caller has already rejected honeypot hits. */
export async function createTicket(db: Db, raw: unknown, ip: string): Promise<{ ref: string }> {
  const t = ticketInput.parse(raw);
  await hit(db, `ticket:${ip}`, 5, 3600);
  const ref = newRef();
  await db.insert(supportTickets).values({ ...t, ref });
  return { ref };
}

export async function listTickets(db: Db, principal: Principal, status: "open" | "closed" | "all" = "open") {
  requirePermission(principal, "support:manage", null);
  const q = db.select().from(supportTickets);
  const rows = await (status === "all" ? q : q.where(eq(supportTickets.status, status)))
    .orderBy(desc(supportTickets.createdAt))
    .limit(200);
  return rows;
}

export async function setTicketStatus(db: Db, principal: Principal, id: string, status: "open" | "closed") {
  requirePermission(principal, "support:manage", null);
  const [row] = await db
    .update(supportTickets)
    .set({
      status,
      closedAt: status === "closed" ? new Date() : null,
      handledBy: principal.userId,
    })
    .where(eq(supportTickets.id, id))
    .returning({ ref: supportTickets.ref });
  if (!row) throw new NotFoundError("Ticket not found");
  await audit(db, {
    actorId: principal.userId,
    action: status === "closed" ? "ticket.closed" : "ticket.reopened",
    entityType: "ticket",
    entityId: id,
    detail: row.ref,
  });
}
