ALTER TABLE "order" ADD COLUMN "confirmation_emailed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "shop_notified_at" timestamp with time zone;