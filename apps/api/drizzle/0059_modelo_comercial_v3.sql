-- Migration 0059 — Modelo comercial v3 (ADR-079, .specs/modelo-comercial-v3).
--
-- Expand-only: tablas, columnas nulas o con default, y un DROP NOT NULL
-- (relajación) sobre liquidaciones.tier_slug_aplicado para que una
-- liquidación v3 (sin tier de membresía) quepa. Ningún dato existente
-- cambia de significado. PRICING_V3_ACTIVATED sigue en false: nada lee
-- estas columnas hasta que el PO encienda el flag.
--
-- `modalidad_carga` (spot | programada) es el campo que ADR-079 §2 llama
-- `tipo_carga`; ese nombre ya lo usa el enum de naturaleza de carga
-- (carga_seca, refrigerada, ...) y la columna viajes.tipo_carga.

CREATE TYPE "modalidad_carga" AS ENUM ('spot', 'programada');
--> statement-breakpoint

-- ADR-079 §3: configuración comercial versionada, editable desde admin.
-- Cada cambio es una fila nueva; nunca UPDATE de una publicada.
CREATE TABLE IF NOT EXISTS "configuracion_comercial" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"config" jsonb NOT NULL,
	"publicada" boolean DEFAULT false NOT NULL,
	"vigente_desde" timestamp with time zone DEFAULT now() NOT NULL,
	"nota_cambio" text NOT NULL,
	"creado_por_email" text NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "configuracion_comercial_version_unique" UNIQUE ("version"),
	CONSTRAINT "chk_configuracion_comercial_nota" CHECK (length(trim("nota_cambio")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "configuracion_comercial_publicada_unique"
	ON "configuracion_comercial" ("publicada") WHERE "publicada" = true;
--> statement-breakpoint

-- Versión 1 publicada con los valores iniciales de ADR-079 §2–§4. Fuente:
-- CONFIGURACION_COMERCIAL_INICIAL en
-- packages/shared-schemas/src/configuracion-comercial.ts (el test de
-- integración verifica que esta fila pase el schema y coincida).
INSERT INTO "configuracion_comercial" ("version", "config", "publicada", "nota_cambio", "creado_por_email")
VALUES (
	1,
	'{
		"comisiones": { "spot_pct": 20, "programada_pct": 10, "retorno_programada_pct": 12 },
		"servicios": {
			"suscripcion_transportista_uf_camion_mes": 1,
			"suscripcion_transportista_gestion_flota_uf_camion_mes": 1.5,
			"suscripcion_generador_uf_empresa_mes": 1,
			"camiones_sin_cobro_por_transportista": 1,
			"huella_carbono": { "modalidad": "por_proyecto" }
		},
		"financiamiento": {
			"originacion_pct": 0.4,
			"anticipo_documento_pct": 90,
			"plazo_pago_generador_dias": 30,
			"plazo_liberacion_transportista_dias": 5
		},
		"impuestos": { "iva_pct": 19 }
	}'::jsonb,
	true,
	'Valores iniciales de ADR-079 (acuerdo comercial 2026-08-26)',
	'sistema@boosterchile.com'
)
ON CONFLICT ("version") DO NOTHING;
--> statement-breakpoint

-- ADR-079 §2: modalidad fijada al publicar y tasa congelada en la solicitud.
ALTER TABLE "viajes" ADD COLUMN IF NOT EXISTS "modalidad_carga" "modalidad_carga" DEFAULT 'spot' NOT NULL;
--> statement-breakpoint
ALTER TABLE "viajes" ADD COLUMN IF NOT EXISTS "comision_pct_aplicada" numeric(5, 2);
--> statement-breakpoint
ALTER TABLE "viajes" ADD COLUMN IF NOT EXISTS "configuracion_comercial_id" uuid REFERENCES "configuracion_comercial"("id");
--> statement-breakpoint

-- ADR-079 §2: contrato programado habilitado por el platform-admin.
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "contrato_programado_activado_en" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "contrato_programado_activado_por" text;
--> statement-breakpoint

-- ADR-079 §6: liquidación v3 (columnas v2 quedan @deprecated, sin DROP).
ALTER TABLE "liquidaciones" ADD COLUMN IF NOT EXISTS "precio_transportista_clp" integer;
--> statement-breakpoint
ALTER TABLE "liquidaciones" ADD COLUMN IF NOT EXISTS "precio_generador_clp" integer;
--> statement-breakpoint
ALTER TABLE "liquidaciones" ADD COLUMN IF NOT EXISTS "total_factura_generador_clp" integer;
--> statement-breakpoint
ALTER TABLE "liquidaciones" ADD COLUMN IF NOT EXISTS "modalidad_carga" "modalidad_carga";
--> statement-breakpoint
ALTER TABLE "liquidaciones" ADD COLUMN IF NOT EXISTS "configuracion_comercial_id" uuid REFERENCES "configuracion_comercial"("id");
--> statement-breakpoint
ALTER TABLE "liquidaciones" ALTER COLUMN "tier_slug_aplicado" DROP NOT NULL;
--> statement-breakpoint

-- ADR-079 §4: suscripciones en UF con el valor del día capturado.
ALTER TABLE "facturas_booster_clp" ADD COLUMN IF NOT EXISTS "monto_uf" numeric(12, 4);
--> statement-breakpoint
ALTER TABLE "facturas_booster_clp" ADD COLUMN IF NOT EXISTS "uf_valor_clp" numeric(12, 2);
