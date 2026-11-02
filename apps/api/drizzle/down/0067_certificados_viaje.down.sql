-- REVERSE-SQL MANUAL — 0067_metricas_viaje_alertas_decision (ADR-066).
-- ⚠️ MANUAL-APPLY-ONLY: el auto-migrator es forward-only y no lee este directorio.
-- Data-safe solo mientras nadie lea la columna; en prod preferí rollback de código.
--   AUTH_MODE=password bash scripts/db/connect.sh -f apps/api/drizzle/down/0067_metricas_viaje_alertas_decision.down.sql

-- 0067: primero la FK de metricas_viaje, después la tabla. Borra el historial
-- de versiones; las 4 columnas certificado_* de metricas_viaje quedan como están.
ALTER TABLE metricas_viaje DROP COLUMN IF EXISTS certificado_vigente_id;
DROP TABLE IF EXISTS certificados_viaje;
