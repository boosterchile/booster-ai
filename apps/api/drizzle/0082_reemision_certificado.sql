-- Migration 0082 — Motivo de la reemisión de un certificado
-- (spec reemision-certificado, parte 3).
--
-- Una versión mayor que 1 de un certificado existe porque alguien la reemitió,
-- y lleva el motivo, de una lista cerrada (spec §3.4). La versión 1 no lleva
-- motivo: es la emisión.
--
--   * certificados_viaje.motivo_reemision, opcional, con su restricción.
--   * tipo_evento_viaje: certificado_reemitido, para el evento del viaje que
--     deja quién la pidió y las dos huellas (spec §3.2).
--
-- Expand-only (ADR-066): columna nueva nula y un valor de enum al final.
-- La restricción valida las filas existentes: hoy todas son versión 1 sin
-- motivo. Ninguna migración usa el valor nuevo del enum (ver la nota de
-- transacciones de 0055). Rollback de la revisión Cloud Run seguro: una
-- versión previa no lee la columna ni produce el valor.

ALTER TABLE "certificados_viaje" ADD COLUMN IF NOT EXISTS "motivo_reemision" varchar(40);
--> statement-breakpoint
ALTER TABLE "certificados_viaje" ADD CONSTRAINT "ck_certificados_viaje_motivo"
  CHECK (
    (version = 1 AND motivo_reemision IS NULL)
    OR (version > 1 AND motivo_reemision IS NOT NULL AND motivo_reemision IN ('factor_impreso_no_corresponde'))
  );
--> statement-breakpoint
ALTER TYPE "tipo_evento_viaje" ADD VALUE IF NOT EXISTS 'certificado_reemitido';
