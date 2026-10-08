-- Migration 0059 — Eco-routing en tiempo real (T10-23, ADR-012 Capa 1).
--
-- Expand-only: tabla y enums nuevos, sin tocar filas existentes. Una fila por
-- congestión detectada en un viaje activo; si hubo alternativa material lleva
-- la ruta sugerida y la respuesta explícita del conductor (adopción).
-- El PR de retiro de demo (#748) también trae una 0059: el que se mergee
-- segundo se renumera (el journal no admite huecos ni duplicados).

CREATE TYPE "estado_sugerencia_ruta" AS ENUM ('congestion_sin_alternativa', 'sugerida');
--> statement-breakpoint
CREATE TYPE "motivo_sugerencia_ruta" AS ENUM ('emisiones', 'tiempo');
--> statement-breakpoint
CREATE TYPE "respuesta_sugerencia_ruta" AS ENUM ('aceptada', 'rechazada');
--> statement-breakpoint
CREATE TABLE "sugerencias_ruta" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "asignacion_id" uuid NOT NULL REFERENCES "asignaciones"("id") ON DELETE CASCADE,
  "viaje_id" uuid NOT NULL REFERENCES "viajes"("id") ON DELETE CASCADE,
  "estado" "estado_sugerencia_ruta" NOT NULL,
  "congestion_desde" timestamp with time zone NOT NULL,
  "detectada_en" timestamp with time zone DEFAULT now() NOT NULL,
  "posicion_lat" numeric(10, 7) NOT NULL,
  "posicion_lng" numeric(10, 7) NOT NULL,
  "velocidad_media_kmh" numeric(6, 2) NOT NULL,
  "motivo" "motivo_sugerencia_ruta",
  "polyline_alternativa" text,
  "ahorro_segundos" integer,
  "ahorro_kgco2e" numeric(10, 3),
  "kgco2e_actual" numeric(10, 3),
  "enviada_en" timestamp with time zone,
  "respuesta" "respuesta_sugerencia_ruta",
  "respondida_en" timestamp with time zone,
  CONSTRAINT "ck_sugerencias_ruta_sugerida_completa" CHECK (
    "estado" <> 'sugerida' OR ("motivo" IS NOT NULL AND "polyline_alternativa" IS NOT NULL AND "ahorro_segundos" IS NOT NULL)
  ),
  CONSTRAINT "ck_sugerencias_ruta_respuesta_con_fecha" CHECK (("respuesta" IS NULL) = ("respondida_en" IS NULL))
);
--> statement-breakpoint
CREATE INDEX "idx_sugerencias_ruta_asignacion_detectada" ON "sugerencias_ruta" ("asignacion_id", "detectada_en");
