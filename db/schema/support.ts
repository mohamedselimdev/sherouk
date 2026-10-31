import { check, index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./identity";

export const ticketStatus = pgEnum("ticket_status", ["open", "closed"]);

/** Messages from the public contact form. The team answers by phone or email, outside the system. */
export const supportTickets = pgTable(
  "support_tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Short reference shown to the customer, for example T-8F3K2QX1. */
    ref: text("ref").notNull(),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    /** Optional order reference the message is about. */
    orderRef: text("order_ref"),
    message: text("message").notNull(),
    locale: text("locale").notNull().default("ar"),
    status: ticketStatus("status").notNull().default("open"),
    handledBy: uuid("handled_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("support_tickets_ref_uq").on(t.ref),
    index("support_tickets_status_created_idx").on(t.status, t.createdAt),
    check("support_tickets_contact_chk", sql`${t.email} is not null or ${t.phone} is not null`),
  ],
);
