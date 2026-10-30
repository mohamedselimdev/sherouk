CREATE TYPE "public"."post_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug_ar" text NOT NULL,
	"slug_en" text NOT NULL,
	"category" text NOT NULL,
	"cover_image" text,
	"title_ar" text NOT NULL,
	"title_en" text NOT NULL,
	"excerpt_ar" text NOT NULL,
	"excerpt_en" text NOT NULL,
	"body_ar" text NOT NULL,
	"body_en" text NOT NULL,
	"status" "post_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"author_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "posts_published_has_date" CHECK ("posts"."status" <> 'published' or "posts"."published_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "posts_slug_ar_uq" ON "posts" USING btree ("slug_ar");--> statement-breakpoint
CREATE UNIQUE INDEX "posts_slug_en_uq" ON "posts" USING btree ("slug_en");