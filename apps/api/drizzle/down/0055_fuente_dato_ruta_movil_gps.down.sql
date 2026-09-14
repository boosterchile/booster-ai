-- =============================================================================
-- REVERSE-SQL MANUAL — 0055_fuente_dato_ruta_movil_gps (ADR-066)
-- =============================================================================
-- ⚠️ MANUAL-APPLY-ONLY. El auto-migrator (src/db/migrator.ts) es forward-only y
--    NO lee este directorio. Esto NO es un down-migration auto-aplicado.
--
-- ⚠️ ESTE REVERSE NO ES LIMPIO. Leelo entero antes de correrlo.
--
-- Postgres NO tiene `ALTER TYPE ... DROP VALUE`. Sacar un valor de un enum
-- exige recrear el tipo completo y reapuntar cada columna que lo usa, con
-- ACCESS EXCLUSIVE sobre esas tablas y reescritura de la tabla en el ALTER
-- COLUMN TYPE. Es caro y bloqueante, no un undo barato.
--
-- --- CASI SIEMPRE NO QUERÉS ESTO ---------------------------------------------
--
-- La 0055 es puramente aditiva y el valor agregado es INERTE mientras ningún
-- código lo escriba: un enum con un valor de más no rompe lecturas, no cambia
-- filas y no afecta a una revisión vieja de Cloud Run (nunca produce ni recibe
-- 'movil_gps'). El camino correcto ante un problema con ADR-077 es rollback de
-- CÓDIGO —o un forward-fix—, dejando el valor en la BD sin usar. Correr este
-- archivo solo tiene sentido si hay una razón dura para que el tipo vuelva a
-- tener exactamente tres valores. Ver docs/runbooks/db-migration-rollback.md.
--
-- --- QUÉ HACE SI IGUAL LO CORRÉS ---------------------------------------------
--
-- Swap de tipo con guarda de datos. Aborta la transacción entera si alguna fila
-- ya tiene 'movil_gps': en ese caso NO hay reverse data-safe posible —el valor
-- es dato de negocio (de dónde salió la distancia de un viaje, ADR-077 §1) y
-- degradarlo a otro valor mentiría sobre la fuente en un registro auditable.
-- Si llegaste ahí, el camino es PITR, no este archivo.
--
-- Blast radius verificado sobre la cadena 0000–0055: una sola columna usa el
-- tipo, `metricas_viaje.fuente_dato_ruta`, sin DEFAULT, sin índice propio y sin
-- vista ni función que lo referencie. Si eso cambió, este archivo quedó corto:
-- revisá antes con
--   SELECT table_name, column_name FROM information_schema.columns
--    WHERE udt_name = 'fuente_dato_ruta';
--
-- Aplicar a mano vía bastion en modo password (DDL):
--   AUTH_MODE=password bash scripts/db/connect.sh -f apps/api/drizzle/down/0055_fuente_dato_ruta_movil_gps.down.sql
--
-- ⚠️ NO actualiza drizzle.__drizzle_migrations: si la migración forward sigue en
--    el repo, el próximo startup la re-aplica (la 0055 usa `ADD VALUE IF NOT
--    EXISTS`, así que re-aplicarla es un no-op limpio). Parche puente, no undo
--    permanente — coordiná con un forward-fix o PITR.
-- =============================================================================

BEGIN;

-- Guarda: si el valor ya está en uso, abortar todo. La comparación castea a
-- text a propósito, para que este archivo no explote con "invalid input value"
-- si se corre contra una BD donde la 0055 nunca se aplicó.
DO $$
DECLARE
  filas_afectadas bigint;
BEGIN
  SELECT count(*) INTO filas_afectadas
    FROM metricas_viaje
   WHERE fuente_dato_ruta::text = 'movil_gps';

  IF filas_afectadas > 0 THEN
    RAISE EXCEPTION
      'Reverse abortado: % fila(s) de metricas_viaje ya usan fuente_dato_ruta = movil_gps. No hay reverse data-safe; usar PITR o forward-fix (ADR-077 §1).',
      filas_afectadas;
  END IF;
END $$;

ALTER TYPE "fuente_dato_ruta" RENAME TO "fuente_dato_ruta_old";
--> statement-breakpoint

CREATE TYPE "fuente_dato_ruta" AS ENUM (
  'teltonika_gps',
  'maps_directions',
  'manual_declared'
);
--> statement-breakpoint

ALTER TABLE "metricas_viaje"
  ALTER COLUMN "fuente_dato_ruta" TYPE "fuente_dato_ruta"
  USING "fuente_dato_ruta"::text::"fuente_dato_ruta";
--> statement-breakpoint

DROP TYPE "fuente_dato_ruta_old";

COMMIT;
