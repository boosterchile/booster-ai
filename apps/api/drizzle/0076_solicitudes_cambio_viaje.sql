-- Migration 0076 — Solicitudes de cambio de una carga asignada
-- (spec editar-anular-cargas, M3).
--
-- Después del match, todo cambio que no sea un dato libre lo propone el
-- generador y lo acepta o rechaza el transportista. Mientras la solicitud
-- está pendiente el viaje conserva los datos originales y la recogida queda
-- bloqueada (§12-P7). Una sola pendiente por viaje.
--
-- Expand-only (ADR-066): tipo y tabla nuevos, sin tocar filas existentes.
-- Rollback de la revisión Cloud Run seguro: una versión previa no lee la
-- tabla.

CREATE TYPE "estado_solicitud_cambio" AS ENUM (
  'pendiente',
  'aceptada',
  'rechazada',
  'retirada',
  'invalidada'
);
--> statement-breakpoint
CREATE TABLE "solicitudes_cambio_viaje" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "viaje_id" uuid NOT NULL REFERENCES "viajes"("id"),
  "asignacion_id" uuid NOT NULL REFERENCES "asignaciones"("id"),
  "solicitado_por_id" uuid NOT NULL REFERENCES "usuarios"("id"),
  "estado" "estado_solicitud_cambio" DEFAULT 'pendiente' NOT NULL,
  "cambios" jsonb NOT NULL,
  "valores_anteriores" jsonb NOT NULL,
  "respondido_por_id" uuid REFERENCES "usuarios"("id"),
  "respondido_en" timestamp with time zone,
  "razon_respuesta" text,
  "motivo_invalidacion" varchar(40),
  "ultimo_recordatorio_en" timestamp with time zone,
  "recordatorios_enviados" integer DEFAULT 0 NOT NULL,
  "creado_en" timestamp with time zone DEFAULT now() NOT NULL,
  "cerrado_en" timestamp with time zone,
  CONSTRAINT "ck_solicitud_cambio_cerrada"
    CHECK (("estado" = 'pendiente') = ("cerrado_en" IS NULL)),
  CONSTRAINT "ck_solicitud_cambio_respondida"
    CHECK ("estado" NOT IN ('aceptada', 'rechazada')
      OR ("respondido_por_id" IS NOT NULL AND "respondido_en" IS NOT NULL)),
  CONSTRAINT "ck_solicitud_cambio_motivo_invalidacion"
    CHECK ("motivo_invalidacion" IS NULL
      OR "motivo_invalidacion" IN ('viaje_cancelado', 'datos_cambiaron', 'viaje_no_asignado'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_solicitud_cambio_pendiente"
  ON "solicitudes_cambio_viaje" ("viaje_id") WHERE "estado" = 'pendiente';
--> statement-breakpoint
CREATE INDEX "idx_solicitudes_cambio_asignacion"
  ON "solicitudes_cambio_viaje" ("asignacion_id", "estado");
--> statement-breakpoint
CREATE INDEX "idx_solicitudes_cambio_pendientes"
  ON "solicitudes_cambio_viaje" ("creado_en") WHERE "estado" = 'pendiente';
