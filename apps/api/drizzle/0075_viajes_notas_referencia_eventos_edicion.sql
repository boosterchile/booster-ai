-- Migration 0075 — Notas y referencia de la carga + eventos de edición
-- (spec editar-anular-cargas, M1).
--
-- viajes.notas (≤ 1000) y viajes.referencia (≤ 100): datos libres que el
-- generador edita en cualquier estado no terminal (§12-P4). Los ven el
-- transportista y el conductor; no el seguimiento público.
-- tipo_evento_viaje: carga_editada, cambio_solicitado, cambio_respondido.
--
-- Expand-only (ADR-066):
--   * Columnas nuevas nulas, sin default ni backfill.
--   * ADD VALUE appendeados al final del enum, sin BEFORE/AFTER: los valores
--     existentes no cambian de orden. Ninguna migración de este lote usa los
--     valores nuevos (ver la nota de transacciones de 0055): solo el código
--     los escribe, después del migrate.
-- Rollback de la revisión Cloud Run seguro: una versión previa del código no
-- lee las columnas ni produce los valores nuevos.

ALTER TABLE "viajes" ADD COLUMN IF NOT EXISTS "notas" text;
ALTER TABLE "viajes" ADD COLUMN IF NOT EXISTS "referencia" varchar(100);
ALTER TABLE "viajes" ADD CONSTRAINT "ck_viajes_notas_largo"
  CHECK ("notas" IS NULL OR char_length("notas") <= 1000);

ALTER TYPE "tipo_evento_viaje" ADD VALUE IF NOT EXISTS 'carga_editada';
ALTER TYPE "tipo_evento_viaje" ADD VALUE IF NOT EXISTS 'cambio_solicitado';
ALTER TYPE "tipo_evento_viaje" ADD VALUE IF NOT EXISTS 'cambio_respondido';
