-- REVERSE-SQL MANUAL — 0068_metricas_viaje_desglose_ttw_wtt (HC-003 T1).
-- ⚠️ MANUAL-APPLY-ONLY: el auto-migrator es forward-only y no lee este directorio.
--   AUTH_MODE=password bash scripts/db/connect.sh -f apps/api/drizzle/down/0068_metricas_viaje_desglose_ttw_wtt.down.sql
ALTER TABLE metricas_viaje DROP COLUMN IF EXISTS fuente_ref;
ALTER TABLE metricas_viaje DROP COLUMN IF EXISTS wtt_ref;
ALTER TABLE metricas_viaje DROP COLUMN IF EXISTS ttw_ref;
ALTER TABLE metricas_viaje DROP COLUMN IF EXISTS factores_fuente;
ALTER TABLE metricas_viaje DROP COLUMN IF EXISTS intensidad_gco2e_por_tkm;
ALTER TABLE metricas_viaje DROP COLUMN IF EXISTS emisiones_kgco2e_wtt;
ALTER TABLE metricas_viaje DROP COLUMN IF EXISTS emisiones_kgco2e_ttw;
