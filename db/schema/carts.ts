import { sql } from "drizzle-orm";
import { check, integer, pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { customers } from "./identity";
import { productVariants } from "./catalog";

/** Guest or customer cart. Server-side cart logic and pricing arrive in Phase 4; the shape is fixed now. */
export const carts = pgTable("carts", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const cartLines = pgTable(
  "cart_lines",
  {
    cartId: uuid("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.cartId, t.variantId] }),
    check("cart_lines_qty_chk", sql`${t.quantity} between 1 and 10`),
  ],
);
