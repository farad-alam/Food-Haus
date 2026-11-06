ALTER TABLE "item" ADD COLUMN "allergens_entered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "option" ADD COLUMN "allergens" jsonb;--> statement-breakpoint
ALTER TABLE "option" ADD COLUMN "allergens_entered_at" timestamp with time zone;--> statement-breakpoint
-- Allergen data is safety-critical: a list only counts if a person explicitly entered it, and now
-- that is recorded (allergens_entered_at). Lists saved before this column existed have no such
-- record, so they are reset to "not yet entered" rather than trusted. (Nothing had been entered on
-- the live data when this was written; the audit_log still holds every earlier admin edit.)
UPDATE "item" SET "allergens" = NULL WHERE "allergens_entered_at" IS NULL;--> statement-breakpoint
ALTER TABLE "item" ADD CONSTRAINT "item_allergens_provenance" CHECK (("item"."allergens" is null) = ("item"."allergens_entered_at" is null));--> statement-breakpoint
ALTER TABLE "option" ADD CONSTRAINT "option_allergens_provenance" CHECK (("option"."allergens" is null) = ("option"."allergens_entered_at" is null));