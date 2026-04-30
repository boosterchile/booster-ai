-- Migración 0001 — Multi-tenant + operaciones (Slice B pre-launch lunes).
--
-- Crea: plans, empresas, users, memberships, vehicles, zones, trip_requests,
-- offers, assignments, trip_events. Extiende whatsapp_intake_drafts con FK
-- a trip_requests (promoción).
--
-- Idempotencia: usa IF NOT EXISTS donde Postgres lo soporta. drizzle-kit no
-- siempre lo emite — manualmente armado para tolerar re-runs en dev.

-- =============================================================================
-- ENUMS
-- =============================================================================

CREATE TYPE "public"."plan_slug" AS ENUM('free', 'standard', 'pro', 'enterprise');--> statement-breakpoint
CREATE TYPE "public"."empresa_status" AS ENUM('pending_verification', 'active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('pending_verification', 'active', 'suspended', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('owner', 'admin', 'dispatcher', 'driver', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('pending_invitation', 'active', 'suspended', 'removed');--> statement-breakpoint
CREATE TYPE "public"."vehicle_type" AS ENUM('pickup', 'truck_3_4', 'truck_dry', 'truck_reefer', 'semi_trailer', 'flatbed', 'tank', 'container', 'other');--> statement-breakpoint
CREATE TYPE "public"."zone_type" AS ENUM('pickup', 'delivery', 'both');--> statement-breakpoint
CREATE TYPE "public"."trip_request_status" AS ENUM('draft', 'pending_match', 'matching', 'offers_sent', 'assigned', 'in_progress', 'delivered', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."offer_status" AS ENUM('pending', 'accepted', 'rejected', 'expired', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."offer_response_channel" AS ENUM('web', 'whatsapp', 'api');--> statement-breakpoint
CREATE TYPE "public"."assignment_status" AS ENUM('assigned', 'picked_up', 'delivered', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."cancellation_actor" AS ENUM('carrier', 'shipper', 'platform_admin');--> statement-breakpoint
CREATE TYPE "public"."trip_event_type" AS ENUM('intake_started', 'intake_captured', 'matching_started', 'offers_sent', 'offer_accepted', 'offer_rejected', 'offer_expired', 'assignment_created', 'pickup_confirmed', 'delivery_confirmed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."trip_event_source" AS ENUM('web', 'whatsapp', 'api', 'system');--> statement-breakpoint

-- =============================================================================
-- BILLING / AUTH
-- =============================================================================

CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" "plan_slug" NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text NOT NULL,
	"monthly_price_clp" integer NOT NULL,
	"features" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint

CREATE TABLE "empresas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legal_name" varchar(200) NOT NULL,
	"rut" varchar(20) NOT NULL,
	"contact_email" varchar(255) NOT NULL,
	"contact_phone" varchar(20) NOT NULL,
	"address_street" varchar(200) NOT NULL,
	"address_city" varchar(100) NOT NULL,
	"address_region" varchar(4) NOT NULL,
	"address_postal_code" varchar(20),
	"is_shipper" boolean DEFAULT false NOT NULL,
	"is_carrier" boolean DEFAULT false NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" "empresa_status" DEFAULT 'pending_verification' NOT NULL,
	"timezone" varchar(50) DEFAULT 'America/Santiago' NOT NULL,
	"max_concurrent_offers_override" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "empresas_rut_unique" UNIQUE("rut")
);
--> statement-breakpoint
ALTER TABLE "empresas" ADD CONSTRAINT "empresas_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "plans"("id");--> statement-breakpoint
CREATE INDEX "idx_empresas_plan" ON "empresas" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "idx_empresas_status" ON "empresas" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_empresas_is_shipper" ON "empresas" USING btree ("is_shipper");--> statement-breakpoint
CREATE INDEX "idx_empresas_is_carrier" ON "empresas" USING btree ("is_carrier");--> statement-breakpoint

CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firebase_uid" varchar(128) NOT NULL,
	"email" varchar(255) NOT NULL,
	"full_name" varchar(200) NOT NULL,
	"phone" varchar(20),
	"rut" varchar(20),
	"status" "user_status" DEFAULT 'pending_verification' NOT NULL,
	"is_platform_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_firebase_uid_unique" UNIQUE("firebase_uid"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE INDEX "idx_users_firebase_uid" ON "users" USING btree ("firebase_uid");--> statement-breakpoint
CREATE INDEX "idx_users_email" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_users_status" ON "users" USING btree ("status");--> statement-breakpoint

CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"empresa_id" uuid NOT NULL,
	"role" "membership_role" NOT NULL,
	"status" "membership_status" DEFAULT 'pending_invitation' NOT NULL,
	"invited_by_user_id" uuid,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"joined_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_memberships_user_empresa" UNIQUE("user_id", "empresa_id")
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_empresa_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_invited_by_user_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id");--> statement-breakpoint
CREATE INDEX "idx_memberships_user" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_memberships_empresa" ON "memberships" USING btree ("empresa_id");--> statement-breakpoint
CREATE INDEX "idx_memberships_role" ON "memberships" USING btree ("role");--> statement-breakpoint
CREATE INDEX "idx_memberships_status" ON "memberships" USING btree ("status");--> statement-breakpoint

-- =============================================================================
-- CARRIER CAPABILITIES
-- =============================================================================

CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"plate" varchar(12) NOT NULL,
	"vehicle_type" "vehicle_type" NOT NULL,
	"capacity_kg" integer NOT NULL,
	"capacity_m3" integer,
	"year_manufactured" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_plate_unique" UNIQUE("plate")
);
--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_empresa_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT;--> statement-breakpoint
CREATE INDEX "idx_vehicles_empresa" ON "vehicles" USING btree ("empresa_id");--> statement-breakpoint
CREATE INDEX "idx_vehicles_type" ON "vehicles" USING btree ("vehicle_type");--> statement-breakpoint
CREATE INDEX "idx_vehicles_active" ON "vehicles" USING btree ("is_active");--> statement-breakpoint

CREATE TABLE "zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"region_code" varchar(4) NOT NULL,
	"comuna_codes" text[],
	"zone_type" "zone_type" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "zones" ADD CONSTRAINT "zones_empresa_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT;--> statement-breakpoint
CREATE INDEX "idx_zones_empresa" ON "zones" USING btree ("empresa_id");--> statement-breakpoint
CREATE INDEX "idx_zones_region" ON "zones" USING btree ("region_code");--> statement-breakpoint
CREATE INDEX "idx_zones_type" ON "zones" USING btree ("zone_type");--> statement-breakpoint

-- =============================================================================
-- OPERATIONS
-- =============================================================================

CREATE TABLE "trip_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracking_code" varchar(12) NOT NULL,
	"shipper_empresa_id" uuid,
	"shipper_whatsapp" varchar(20),
	"created_by_user_id" uuid,
	"origin_address_raw" text NOT NULL,
	"origin_region_code" varchar(4),
	"origin_comuna_code" varchar(10),
	"destination_address_raw" text NOT NULL,
	"destination_region_code" varchar(4),
	"destination_comuna_code" varchar(10),
	"cargo_type" "cargo_type" NOT NULL,
	"cargo_weight_kg" integer,
	"cargo_volume_m3" integer,
	"cargo_description" text,
	"pickup_date_raw" varchar(200) NOT NULL,
	"pickup_window_start" timestamp with time zone,
	"pickup_window_end" timestamp with time zone,
	"proposed_price_clp" integer,
	"status" "trip_request_status" DEFAULT 'pending_match' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_requests_tracking_code_unique" UNIQUE("tracking_code")
);
--> statement-breakpoint
ALTER TABLE "trip_requests" ADD CONSTRAINT "trip_requests_shipper_empresa_id_fk" FOREIGN KEY ("shipper_empresa_id") REFERENCES "empresas"("id");--> statement-breakpoint
ALTER TABLE "trip_requests" ADD CONSTRAINT "trip_requests_created_by_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id");--> statement-breakpoint
CREATE INDEX "idx_trip_requests_shipper_empresa" ON "trip_requests" USING btree ("shipper_empresa_id");--> statement-breakpoint
CREATE INDEX "idx_trip_requests_shipper_wa" ON "trip_requests" USING btree ("shipper_whatsapp");--> statement-breakpoint
CREATE INDEX "idx_trip_requests_status" ON "trip_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_trip_requests_origin_region" ON "trip_requests" USING btree ("origin_region_code");--> statement-breakpoint
CREATE INDEX "idx_trip_requests_created" ON "trip_requests" USING btree ("created_at");--> statement-breakpoint

CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_request_id" uuid NOT NULL,
	"empresa_id" uuid NOT NULL,
	"suggested_vehicle_id" uuid,
	"score" integer NOT NULL,
	"status" "offer_status" DEFAULT 'pending' NOT NULL,
	"response_channel" "offer_response_channel",
	"rejection_reason" text,
	"proposed_price_clp" integer NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_offers_trip_empresa" UNIQUE("trip_request_id", "empresa_id")
);
--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_trip_request_id_fk" FOREIGN KEY ("trip_request_id") REFERENCES "trip_requests"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_empresa_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_suggested_vehicle_id_fk" FOREIGN KEY ("suggested_vehicle_id") REFERENCES "vehicles"("id");--> statement-breakpoint
CREATE INDEX "idx_offers_trip_request" ON "offers" USING btree ("trip_request_id");--> statement-breakpoint
CREATE INDEX "idx_offers_empresa" ON "offers" USING btree ("empresa_id");--> statement-breakpoint
CREATE INDEX "idx_offers_status" ON "offers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_offers_expires" ON "offers" USING btree ("expires_at");--> statement-breakpoint

CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_request_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"empresa_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"driver_user_id" uuid,
	"status" "assignment_status" DEFAULT 'assigned' NOT NULL,
	"agreed_price_clp" integer NOT NULL,
	"pickup_evidence_url" text,
	"delivery_evidence_url" text,
	"cancelled_by_actor" "cancellation_actor",
	"cancellation_reason" text,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"picked_up_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assignments_trip_request_id_unique" UNIQUE("trip_request_id"),
	CONSTRAINT "assignments_offer_id_unique" UNIQUE("offer_id")
);
--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_trip_request_id_fk" FOREIGN KEY ("trip_request_id") REFERENCES "trip_requests"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_offer_id_fk" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_empresa_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_vehicle_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_driver_user_id_fk" FOREIGN KEY ("driver_user_id") REFERENCES "users"("id");--> statement-breakpoint
CREATE INDEX "idx_assignments_empresa" ON "assignments" USING btree ("empresa_id");--> statement-breakpoint
CREATE INDEX "idx_assignments_status" ON "assignments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_assignments_driver" ON "assignments" USING btree ("driver_user_id");--> statement-breakpoint

CREATE TABLE "trip_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_request_id" uuid NOT NULL,
	"assignment_id" uuid,
	"event_type" "trip_event_type" NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" "trip_event_source" NOT NULL,
	"recorded_by_user_id" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trip_events" ADD CONSTRAINT "trip_events_trip_request_id_fk" FOREIGN KEY ("trip_request_id") REFERENCES "trip_requests"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "trip_events" ADD CONSTRAINT "trip_events_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id");--> statement-breakpoint
ALTER TABLE "trip_events" ADD CONSTRAINT "trip_events_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id");--> statement-breakpoint
CREATE INDEX "idx_trip_events_trip_request" ON "trip_events" USING btree ("trip_request_id");--> statement-breakpoint
CREATE INDEX "idx_trip_events_assignment" ON "trip_events" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "idx_trip_events_type" ON "trip_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_trip_events_recorded" ON "trip_events" USING btree ("recorded_at");--> statement-breakpoint

-- =============================================================================
-- LEGACY INTAKE — agregar FK de promoción a trip_requests
-- =============================================================================

ALTER TABLE "whatsapp_intake_drafts" ADD COLUMN "promoted_to_trip_request_id" uuid;--> statement-breakpoint
ALTER TABLE "whatsapp_intake_drafts" ADD CONSTRAINT "whatsapp_intake_drafts_promoted_to_trip_request_id_fk" FOREIGN KEY ("promoted_to_trip_request_id") REFERENCES "trip_requests"("id");
