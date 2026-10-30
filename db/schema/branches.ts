import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  uuid,
  numeric,
} from "drizzle-orm/pg-core";

/** Branch-agnostic: the number of branches is data, never code. */
export const branches = pgTable("branches", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  /** Public pages and structured data only show branches whose details a human has verified. */
  verified: boolean("verified").notNull().default(false),
  offersExams: boolean("offers_exams").notNull().default(false),
  pickupEnabled: boolean("pickup_enabled").notNull().default(false),
  /** Online delivery orders are allocated from branches that have this on. */
  fulfilsOnline: boolean("fulfils_online").notNull().default(false),
  phone: text("phone"),
  email: text("email"),
  latitude: numeric("latitude", { precision: 9, scale: 6 }),
  longitude: numeric("longitude", { precision: 9, scale: 6 }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const branchTranslations = pgTable(
  "branch_translations",
  {
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    locale: text("locale").notNull(),
    name: text("name").notNull(),
    city: text("city").notNull(),
    address: text("address").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.branchId, t.locale] }),
    check("branch_tr_locale_chk", sql`${t.locale} in ('ar','en')`),
  ],
);

export const branchHours = pgTable(
  "branch_hours",
  {
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    /** 0 = Sunday … 6 = Saturday (Africa/Cairo local time). */
    weekday: integer("weekday").notNull(),
    opensAt: time("opens_at"),
    closesAt: time("closes_at"),
    closed: boolean("closed").notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.branchId, t.weekday] }),
    check("branch_hours_weekday_chk", sql`${t.weekday} between 0 and 6`),
  ],
);
