-- Migration 0061 — Mandato de cobro (ADR-080 §2, .specs/mandato-de-cobro).
--
-- Expand-only: dos enums, una columna con default y una tabla nueva. Con
-- MANDATO_COBRO_ACTIVATED = false (default) toda liquidación nueva queda
-- 'conector' y nadie escribe eventos de pago (ADR-080 Verificación 1).
--
-- eventos_pago_viaje es append-only: una corrección es un evento nuevo, nunca
-- una edición. Lo garantiza el trigger, no la disciplina del código.

CREATE TYPE "modo_flujo" AS ENUM ('conector', 'mandato_cobro');
--> statement-breakpoint
ALTER TABLE "liquidaciones" ADD COLUMN IF NOT EXISTS "modo_flujo" "modo_flujo" DEFAULT 'conector' NOT NULL;
--> statement-breakpoint

CREATE TYPE "tipo_evento_pago" AS ENUM (
	'recepcion_conforme',
	'cobro_registrado',
	'mora_registrada',
	'liberacion_booster',
	'anticipo_operador',
	'disputa_abierta',
	'disputa_resuelta'
);
--> statement-breakpoint

-- Clave por asignación (= viaje): la recepción conforme se registra junto a
-- la liquidación y ambas cuelgan de la misma asignación. `secuencia` fija el
-- orden de registro, que es el orden en que se reduce el estado.
CREATE TABLE IF NOT EXISTS "eventos_pago_viaje" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"secuencia" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
	"asignacion_id" uuid NOT NULL REFERENCES "asignaciones"("id") ON DELETE RESTRICT,
	"tipo" "tipo_evento_pago" NOT NULL,
	"monto_clp" integer,
	"evidencia_tipo" text NOT NULL,
	"evidencia_ref" text NOT NULL,
	"detalle" text,
	"ocurrido_en" timestamp with time zone NOT NULL,
	"registrado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"registrado_por" text NOT NULL,
	CONSTRAINT "chk_eventos_pago_viaje_evidencia" CHECK (
		length(trim("evidencia_tipo")) > 0 AND length(trim("evidencia_ref")) > 0
	),
	CONSTRAINT "chk_eventos_pago_viaje_monto" CHECK ("monto_clp" IS NULL OR "monto_clp" > 0),
	CONSTRAINT "chk_eventos_pago_viaje_registrado_por" CHECK (length(trim("registrado_por")) > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_eventos_pago_viaje_asignacion"
	ON "eventos_pago_viaje" ("asignacion_id", "secuencia");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_eventos_pago_viaje_recepcion"
	ON "eventos_pago_viaje" ("asignacion_id") WHERE "tipo" = 'recepcion_conforme';
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "rechazar_cambio_evento_pago"() RETURNS trigger
	LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'eventos_pago_viaje es append-only: % no permitido (ADR-080 §2)', TG_OP
		USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_eventos_pago_viaje_append_only" ON "eventos_pago_viaje";
--> statement-breakpoint
CREATE TRIGGER "trg_eventos_pago_viaje_append_only"
	BEFORE UPDATE OR DELETE ON "eventos_pago_viaje"
	FOR EACH ROW EXECUTE FUNCTION "rechazar_cambio_evento_pago"();
