-- REVERSE-SQL MANUAL — 0067_certificados_viaje (ADR-066).
-- ⚠️ MANUAL-APPLY-ONLY: el auto-migrator es forward-only y no lee este directorio.
-- Borra el historial de versiones; las 4 columnas certificado_* quedan como están.
--   AUTH_MODE=password bash scripts/db/connect.sh -f apps/api/drizzle/down/0067_certificados_viaje.down.sql
ALTER TABLE metricas_viaje DROP COLUMN IF EXISTS certificado_vigente_id;
DROP TABLE IF EXISTS certificados_viaje;
