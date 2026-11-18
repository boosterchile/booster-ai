-- Reverso MANUAL de 0087 (el migrator es forward-only, ADR-066).
--
-- Solo es seguro mientras ninguna versión use el motivo nuevo. Comprobar antes:
--   SELECT count(*) FROM certificados_viaje
--   WHERE motivo_reemision = 'distancia_medida_no_plausible';   -- debe ser 0

ALTER TABLE "certificados_viaje" DROP CONSTRAINT IF EXISTS "ck_certificados_viaje_motivo";
ALTER TABLE "certificados_viaje" ADD CONSTRAINT "ck_certificados_viaje_motivo"
  CHECK (
    (version = 1 AND motivo_reemision IS NULL)
    OR (version > 1 AND motivo_reemision IS NOT NULL AND motivo_reemision IN ('factor_impreso_no_corresponde'))
  );
