-- REVERSE-SQL MANUAL — 0066_metricas_viaje_alertas_decision (ADR-066).
-- ⚠️ MANUAL-APPLY-ONLY: el auto-migrator es forward-only y no lee este directorio.
-- Data-safe solo mientras nadie lea la columna; en prod preferí rollback de código.
--   AUTH_MODE=password bash scripts/db/connect.sh -f apps/api/drizzle/down/0066_metricas_viaje_alertas_decision.down.sql

ALTER TABLE metricas_viaje DROP COLUMN IF EXISTS alertas_decision;
