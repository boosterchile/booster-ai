-- =============================================================================
-- REVERSE-SQL MANUAL — 0054_viajes_origin_latlng (ADR-066)
-- =============================================================================
-- ⚠️ MANUAL-APPLY-ONLY. El auto-migrator (src/db/migrator.ts) es forward-only y
--    NO lee este directorio. Esto NO es un down-migration auto-aplicado.
--
-- Revierte la migración 0054 (columnas origin_latitude / origin_longitude de
-- viajes). Data-safe SOLO mientras nadie las haya poblado: dropearlas pierde
-- la geocodificación persistida del origen (Task 4), que es re-derivable
-- llamando de nuevo a Routes API sobre origen_direccion_raw (no hay dato de
-- negocio irrecuperable, pero sí costo de cuota). En prod preferí rollback de
-- código (la migración es aditiva → una revisión previa ignora las columnas)
-- o PITR.
--
-- Aplicar a mano vía bastion en modo password (DDL):
--   AUTH_MODE=password bash scripts/db/connect.sh -f apps/api/drizzle/down/0054_viajes_origin_latlng.down.sql
--
-- ⚠️ NO actualiza drizzle.__drizzle_migrations: si la migración forward sigue en
--    el repo, el próximo startup la re-aplica. Parche puente, no undo permanente.
-- =============================================================================

ALTER TABLE viajes DROP COLUMN IF EXISTS origin_latitude;
--> statement-breakpoint

ALTER TABLE viajes DROP COLUMN IF EXISTS origin_longitude;
