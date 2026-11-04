-- REVERSE-SQL MANUAL — 0065_metricas_viaje_decision_fuente (ADR-066).
-- ⚠️ MANUAL-APPLY-ONLY: el auto-migrator es forward-only y no lee este directorio.
-- Data-safe solo mientras nadie haya poblado las columnas; en prod preferí
-- rollback de código (la migración es aditiva) o PITR. No actualiza
-- drizzle.__drizzle_migrations.
--   AUTH_MODE=password bash scripts/db/connect.sh -f apps/api/drizzle/down/0065_metricas_viaje_decision_fuente.down.sql

ALTER TABLE metricas_viaje DROP COLUMN IF EXISTS fuente_distancia;
--> statement-breakpoint
ALTER TABLE metricas_viaje DROP COLUMN IF EXISTS fuente_energia;
--> statement-breakpoint
ALTER TABLE metricas_viaje DROP COLUMN IF EXISTS motivo_fallback;
--> statement-breakpoint
ALTER TABLE metricas_viaje DROP COLUMN IF EXISTS decision_version;
--> statement-breakpoint
ALTER TABLE metricas_viaje DROP COLUMN IF EXISTS decidido_en;
--> statement-breakpoint
ALTER TABLE metricas_viaje DROP COLUMN IF EXISTS peso_declarado;
