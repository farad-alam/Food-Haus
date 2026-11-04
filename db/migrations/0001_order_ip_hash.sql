ALTER TABLE "order" ADD COLUMN "ip_hash" text;--> statement-breakpoint
CREATE INDEX "order_phone_idx" ON "order" USING btree ("phone","created_at");--> statement-breakpoint
CREATE INDEX "order_ip_idx" ON "order" USING btree ("ip_hash","created_at");