-- Reverso MANUAL de 0082 (el migrator es forward-only, ADR-066).
--
-- Solo es seguro mientras no exista ninguna versión reemitida. Comprobar antes:
--   SELECT count(*) FROM certificados_viaje WHERE version > 1;   -- debe ser 0
--
-- Postgres no permite quitar un valor de un enum: 'certificado_reemitido'
-- queda en tipo_evento_viaje. Es inofensivo mientras ninguna fila lo use.

ALTER TABLE "certificados_viaje" DROP CONSTRAINT IF EXISTS "ck_certificados_viaje_motivo";
ALTER TABLE "certificados_viaje" DROP COLUMN IF EXISTS "motivo_reemision";
