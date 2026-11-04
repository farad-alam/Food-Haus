CREATE TYPE "public"."admin_role" AS ENUM('owner', 'manager', 'kitchen');--> statement-breakpoint
CREATE TYPE "public"."offer_channel" AS ENUM('any', 'delivery', 'collection');--> statement-breakpoint
CREATE TYPE "public"."offer_type" AS ENUM('percentage', 'fixed', 'free_delivery', 'bogof');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pending_payment', 'received', 'preparing', 'ready', 'out_for_delivery', 'completed', 'rejected', 'cancelled', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."order_type" AS ENUM('delivery', 'collection');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('card', 'cash');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('unpaid', 'paid', 'failed', 'refunded');--> statement-breakpoint
CREATE TABLE "admin_session" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_user" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "admin_role" NOT NULL,
	"totp_secret_enc" text,
	"totp_last_step" integer,
	"disabled" boolean DEFAULT false NOT NULL,
	"last_login" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_event" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	CONSTRAINT "category_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "closure" (
	"id" serial PRIMARY KEY NOT NULL,
	"day" date NOT NULL,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "delivery_zone" (
	"id" serial PRIMARY KEY NOT NULL,
	"district" text NOT NULL,
	"fee" integer NOT NULL,
	"min_order" integer NOT NULL,
	"estimated_minutes" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "delivery_zone_district_unique" UNIQUE("district")
);
--> statement-breakpoint
CREATE TABLE "item" (
	"id" serial PRIMARY KEY NOT NULL,
	"category_id" integer NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price" integer NOT NULL,
	"photo" text,
	"photo_alt" text,
	"allergens" jsonb,
	"dietary_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sold_out" boolean DEFAULT false NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "item_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "offer" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" "offer_type" NOT NULL,
	"value" integer,
	"applies_to_category_id" integer,
	"channel" "offer_channel" DEFAULT 'any' NOT NULL,
	"code" text,
	"min_spend" integer DEFAULT 0 NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"usage_limit" integer,
	"used_count" integer DEFAULT 0 NOT NULL,
	"show_on_site" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opening_hours" (
	"id" serial PRIMARY KEY NOT NULL,
	"weekday" integer NOT NULL,
	"opens_at" time NOT NULL,
	"closes_at" time NOT NULL
);
--> statement-breakpoint
CREATE TABLE "option" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"name" text NOT NULL,
	"price_change" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "option_group" (
	"id" serial PRIMARY KEY NOT NULL,
	"item_id" integer,
	"category_id" integer,
	"name" text NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"min_picks" integer DEFAULT 0 NOT NULL,
	"max_picks" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order" (
	"id" serial PRIMARY KEY NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "order_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1001 CACHE 1),
	"token" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"type" "order_type" NOT NULL,
	"status" "order_status" DEFAULT 'pending_payment' NOT NULL,
	"payment_method" "payment_method" NOT NULL,
	"payment_status" "payment_status" DEFAULT 'unpaid' NOT NULL,
	"subtotal" integer NOT NULL,
	"delivery_fee" integer DEFAULT 0 NOT NULL,
	"discount" integer DEFAULT 0 NOT NULL,
	"total" integer NOT NULL,
	"customer_name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text NOT NULL,
	"address" text,
	"postcode" text,
	"note" text,
	"rejection_reason" text,
	"prep_minutes" integer,
	"scheduled_for" timestamp with time zone,
	"stripe_session_id" text,
	"offer_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"anonymised_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "order_item" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"name" text NOT NULL,
	"unit_price" integer NOT NULL,
	"quantity" integer NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"line_total" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_token" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"paused_message" text,
	"default_prep_minutes" integer DEFAULT 20 NOT NULL,
	"notice_bar" text,
	"cash_max_pence" integer,
	"cash_daily_cap_per_phone" integer DEFAULT 3 NOT NULL,
	"cash_daily_cap_per_ip" integer DEFAULT 5 NOT NULL,
	"contact" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_event" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_session" ADD CONSTRAINT "admin_session_user_id_admin_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."admin_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_admin_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."admin_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item" ADD CONSTRAINT "item_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer" ADD CONSTRAINT "offer_applies_to_category_id_category_id_fk" FOREIGN KEY ("applies_to_category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option" ADD CONSTRAINT "option_group_id_option_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."option_group"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_group" ADD CONSTRAINT "option_group_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_group" ADD CONSTRAINT "option_group_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_offer_id_offer_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_token" ADD CONSTRAINT "password_reset_token_user_id_admin_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."admin_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_session_user_idx" ON "admin_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_event_key_idx" ON "auth_event" USING btree ("key","at");--> statement-breakpoint
CREATE INDEX "item_category_idx" ON "item" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_token_idx" ON "order" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "order_idempotency_idx" ON "order" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "order_stripe_session_idx" ON "order" USING btree ("stripe_session_id");--> statement-breakpoint
CREATE INDEX "order_status_idx" ON "order" USING btree ("status","created_at");