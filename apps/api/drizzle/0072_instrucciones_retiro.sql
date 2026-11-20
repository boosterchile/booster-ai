-- Migration 0072 — Instrucciones de retiro por viaje (spec instrucciones-retiro).
--
-- El generador sube el QR o comprobante que le entrega el lugar de retiro,
-- con el lugar y una nota, para que el conductor lo muestre al retirar.
-- Decisión del PO (2026-11-09): va aparte del repositorio documental
-- (documentos_transporte, ADR-070): no pasa por el TED, no tiene retención
-- de 6 años y no cuenta para el cierre de la entrega.
--
-- Expand-only: tabla nueva, ninguna columna anterior cambia.

CREATE TABLE IF NOT EXISTS "instrucciones_retiro" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "viaje_id" uuid NOT NULL,
  "archivo_path" text,
  "archivo_mime" text,
  "lugar" text,
  "nota" text,
  "subido_por" uuid,
  "creado_en" timestamp with time zone DEFAULT now() NOT NULL,
  "actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_instrucciones_retiro_viaje" UNIQUE ("viaje_id"),
  CONSTRAINT "ck_instrucciones_retiro_contenido"
    CHECK ("archivo_path" IS NOT NULL OR "nota" IS NOT NULL),
  CONSTRAINT "ck_instrucciones_retiro_archivo"
    CHECK (("archivo_path" IS NULL) = ("archivo_mime" IS NULL)),
  CONSTRAINT "instrucciones_retiro_viaje_id_viajes_id_fk"
    FOREIGN KEY ("viaje_id") REFERENCES "viajes"("id") ON DELETE restrict,
  CONSTRAINT "instrucciones_retiro_subido_por_usuarios_id_fk"
    FOREIGN KEY ("subido_por") REFERENCES "usuarios"("id")
);
