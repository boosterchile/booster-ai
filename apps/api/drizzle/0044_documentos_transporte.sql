-- Migration 0044 — repositorio documental de transporte (ADR-070, frente F4-4a)
--
-- Crea la tabla `documentos_transporte`: Booster RECIBE y ARCHIVA documentos
-- tributarios de terceros (Guía de Despacho DTE 52, Factura 33, etc.) que
-- amparan la carga de una orden (`viajes`). NO se emite DTE ni hay integración
-- SII (ADR-069). El worker (sub-fase 4b) decodifica el TED PDF417 best-effort;
-- el cierre flexible (4a) exige ≥1 documento subido aunque el TED no decodifique.
--
-- Naming bilingüe (CLAUDE.md): tabla y columnas en español snake_case sin
-- tildes; los valores de `tipo_documento_transporte` son códigos literales del
-- SII (33/34/52/56/61) más `other` y NO se traducen; los demás enums en español.
--
-- Expand-only (audit P1-H / ADR-066): solo CREATE TYPE / CREATE TABLE / CREATE
-- INDEX. Sin DROP, sin RENAME, sin SET NOT NULL retroactivo sobre tablas
-- existentes (es tabla nueva, así que NOT NULL interno es seguro). El rollback
-- de código es seguro — una revisión previa simplemente ignora la tabla nueva.
--
-- FK `viaje_id` → `viajes(id)` ON DELETE RESTRICT: la retención legal (6 años)
-- prohíbe borrar un documento dentro del período; sin cascada al cerrar/borrar
-- la orden (spec O-3).
--
-- Riesgo de despliegue: bajo. No afecta filas ni constraints existentes.

-- 1. Enums.
CREATE TYPE "tipo_documento_transporte" AS ENUM ('33', '34', '52', '56', '61', 'other');
--> statement-breakpoint
CREATE TYPE "estado_extraccion" AS ENUM ('pendiente', 'procesando', 'decodificado', 'ingreso_manual', 'fallido');
--> statement-breakpoint
CREATE TYPE "origen_documento" AS ENUM ('pdf_upload', 'photo_upload', 'xml_intercambio');
--> statement-breakpoint

-- 2. Tabla documentos_transporte.
CREATE TABLE "documentos_transporte" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "viaje_id" uuid NOT NULL REFERENCES "viajes"("id") ON DELETE RESTRICT,
  "file_path" text NOT NULL,
  "file_mime" text NOT NULL,
  "doc_type" "tipo_documento_transporte" NOT NULL,
  "folio" text,
  "rut_emisor" text,
  "razon_social_emisor" text,
  "rut_receptor" text,
  "razon_social_receptor" text,
  "fecha_emision" date,
  "monto_total" numeric(14, 2),
  "ted_raw" text,
  "ted_signature_valid" boolean,
  "extraction_status" "estado_extraccion" NOT NULL DEFAULT 'pendiente',
  "source" "origen_documento" NOT NULL,
  "retention_until" date,
  "subido_por" uuid REFERENCES "usuarios"("id"),
  "creado_en" timestamptz NOT NULL DEFAULT now(),
  "actualizado_en" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- 3. Indexes: por orden (listado del shipper/carrier) y por estado (worker 4b).
CREATE INDEX "idx_documentos_transporte_viaje" ON "documentos_transporte"("viaje_id");
--> statement-breakpoint
CREATE INDEX "idx_documentos_transporte_estado" ON "documentos_transporte"("extraction_status");
