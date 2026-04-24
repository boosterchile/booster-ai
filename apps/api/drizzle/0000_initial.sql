CREATE TYPE "public"."cargo_type" AS ENUM('dry_goods', 'perishable', 'refrigerated', 'frozen', 'fragile', 'dangerous', 'liquid', 'construction', 'agricultural', 'livestock', 'other');--> statement-breakpoint
CREATE TYPE "public"."whatsapp_intake_status" AS ENUM('in_progress', 'captured', 'converted', 'abandoned', 'cancelled');--> statement-breakpoint
CREATE TABLE "whatsapp_intake_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracking_code" varchar(10) NOT NULL,
	"shipper_whatsapp" varchar(20) NOT NULL,
	"origin_address_raw" text NOT NULL,
	"destination_address_raw" text NOT NULL,
	"cargo_type" "cargo_type" NOT NULL,
	"pickup_date_raw" varchar(200) NOT NULL,
	"status" "whatsapp_intake_status" DEFAULT 'captured' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_intake_drafts_tracking_code_unique" UNIQUE("tracking_code")
);
--> statement-breakpoint
CREATE INDEX "idx_whatsapp_intake_shipper" ON "whatsapp_intake_drafts" USING btree ("shipper_whatsapp");--> statement-breakpoint
CREATE INDEX "idx_whatsapp_intake_status" ON "whatsapp_intake_drafts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_whatsapp_intake_created" ON "whatsapp_intake_drafts" USING btree ("created_at");