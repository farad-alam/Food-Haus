CREATE TABLE "sales_report" (
	"day" date PRIMARY KEY NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recipients" integer DEFAULT 0 NOT NULL,
	"summary" jsonb
);
