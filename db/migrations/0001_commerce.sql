CREATE TYPE "public"."coupon_type" AS ENUM('percent', 'fixed');--> statement-breakpoint
CREATE TYPE "public"."delivery_method" AS ENUM('delivery', 'pickup');--> statement-breakpoint
CREATE TYPE "public"."fulfillment_status" AS ENUM('unfulfilled', 'packing', 'ready_for_pickup', 'shipped', 'delivered', 'picked_up', 'returned');--> statement-breakpoint
CREATE TYPE "public"."movement_type" AS ENUM('receipt', 'sale', 'adjustment', 'return_to_stock');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pending_payment', 'confirmed', 'processing', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('online', 'cod');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('unpaid', 'awaiting_collection', 'paid', 'failed', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('active', 'committed', 'released', 'expired');--> statement-breakpoint
CREATE TABLE "branch_inventory" (
	"branch_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"on_hand" integer DEFAULT 0 NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"low_stock_threshold" integer DEFAULT 3 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branch_inventory_branch_id_variant_id_pk" PRIMARY KEY("branch_id","variant_id"),
	CONSTRAINT "inventory_nonneg_chk" CHECK ("branch_inventory"."on_hand" >= 0 and "branch_inventory"."reserved" >= 0),
	CONSTRAINT "inventory_reserved_chk" CHECK ("branch_inventory"."reserved" <= "branch_inventory"."on_hand")
);
--> statement-breakpoint
CREATE TABLE "coupon_redemptions" (
	"coupon_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupon_redemptions_coupon_id_order_id_pk" PRIMARY KEY("coupon_id","order_id")
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"type" "coupon_type" NOT NULL,
	"value" integer NOT NULL,
	"min_subtotal_piasters" integer DEFAULT 0 NOT NULL,
	"max_discount_piasters" integer,
	"max_redemptions" integer,
	"redeemed_count" integer DEFAULT 0 NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupons_value_chk" CHECK ("coupons"."value" > 0 and ("coupons"."type" <> 'percent' or "coupons"."value" <= 10000)),
	CONSTRAINT "coupons_count_chk" CHECK ("coupons"."redeemed_count" >= 0 and ("coupons"."max_redemptions" is null or "coupons"."redeemed_count" <= "coupons"."max_redemptions"))
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"type" text NOT NULL,
	"from_value" text,
	"to_value" text,
	"actor_type" text DEFAULT 'system' NOT NULL,
	"actor_id" uuid,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"title_ar" text NOT NULL,
	"title_en" text NOT NULL,
	"color_key" text NOT NULL,
	"unit_price_piasters" integer NOT NULL,
	"quantity" integer NOT NULL,
	"line_total_piasters" integer NOT NULL,
	CONSTRAINT "order_lines_qty_chk" CHECK ("order_lines"."quantity" between 1 and 10),
	CONSTRAINT "order_lines_total_chk" CHECK ("order_lines"."line_total_piasters" = "order_lines"."unit_price_piasters" * "order_lines"."quantity")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"status" "order_status" DEFAULT 'pending_payment' NOT NULL,
	"payment_status" "payment_status" DEFAULT 'unpaid' NOT NULL,
	"fulfillment_status" "fulfillment_status" DEFAULT 'unfulfilled' NOT NULL,
	"payment_method" "payment_method" NOT NULL,
	"delivery_method" "delivery_method" NOT NULL,
	"branch_id" uuid,
	"customer_id" uuid,
	"contact_name" text NOT NULL,
	"contact_phone" text NOT NULL,
	"contact_email" text,
	"ship_governorate" text,
	"ship_city" text,
	"ship_address" text,
	"notes" text,
	"subtotal_piasters" integer NOT NULL,
	"discount_piasters" integer DEFAULT 0 NOT NULL,
	"shipping_piasters" integer DEFAULT 0 NOT NULL,
	"tax_piasters" integer DEFAULT 0 NOT NULL,
	"total_piasters" integer NOT NULL,
	"currency" text DEFAULT 'EGP' NOT NULL,
	"coupon_id" uuid,
	"coupon_code" text,
	"idempotency_key" text NOT NULL,
	"locale" text DEFAULT 'ar' NOT NULL,
	"exception" text,
	"needs_refund" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_ref_unique" UNIQUE("ref"),
	CONSTRAINT "orders_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "orders_amounts_chk" CHECK ("orders"."subtotal_piasters" >= 0 and "orders"."discount_piasters" >= 0 and "orders"."shipping_piasters" >= 0 and "orders"."tax_piasters" >= 0),
	CONSTRAINT "orders_total_chk" CHECK ("orders"."total_piasters" = "orders"."subtotal_piasters" - "orders"."discount_piasters" + "orders"."shipping_piasters" + "orders"."tax_piasters"),
	CONSTRAINT "orders_discount_chk" CHECK ("orders"."discount_piasters" <= "orders"."subtotal_piasters")
);
--> statement-breakpoint
CREATE TABLE "shipping_rates" (
	"governorate" text PRIMARY KEY NOT NULL,
	"fee_piasters" integer NOT NULL,
	"free_over_piasters" integer,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "shipping_fee_chk" CHECK ("shipping_rates"."fee_piasters" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"type" "movement_type" NOT NULL,
	"quantity" integer NOT NULL,
	"reason" text,
	"order_id" uuid,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "movements_nonzero_chk" CHECK ("stock_movements"."quantity" <> 0)
);
--> statement-breakpoint
CREATE TABLE "stock_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"status" "reservation_status" DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "reservations_qty_chk" CHECK ("stock_reservations"."quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "fulfils_online" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "branch_inventory" ADD CONSTRAINT "branch_inventory_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_inventory" ADD CONSTRAINT "branch_inventory_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_order_line_id_order_lines_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."order_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coupons_code_lower_uq" ON "coupons" USING btree (lower("code"));--> statement-breakpoint
CREATE INDEX "order_events_order_idx" ON "order_events" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "order_lines_order_idx" ON "order_lines" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "orders_branch_idx" ON "orders" USING btree ("branch_id","created_at");--> statement-breakpoint
CREATE INDEX "movements_stock_idx" ON "stock_movements" USING btree ("branch_id","variant_id","created_at");--> statement-breakpoint
CREATE INDEX "reservations_status_idx" ON "stock_reservations" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "reservations_order_idx" ON "stock_reservations" USING btree ("order_id");