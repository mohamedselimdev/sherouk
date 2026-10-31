CREATE TYPE "public"."ticket_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"order_ref" text,
	"message" text NOT NULL,
	"locale" text DEFAULT 'ar' NOT NULL,
	"status" "ticket_status" DEFAULT 'open' NOT NULL,
	"handled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "support_tickets_contact_chk" CHECK ("support_tickets"."email" is not null or "support_tickets"."phone" is not null)
);
--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_handled_by_users_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "support_tickets_ref_uq" ON "support_tickets" USING btree ("ref");--> statement-breakpoint
CREATE INDEX "support_tickets_status_created_idx" ON "support_tickets" USING btree ("status","created_at");