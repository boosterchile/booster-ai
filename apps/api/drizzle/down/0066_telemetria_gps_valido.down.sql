-- MANUAL-APPLY-ONLY. El auto-migrator no lee este directorio (ADR-066).
-- Revierte 0066: saca los índices parciales de la última posición válida.
-- La lectura vuelve al índice general y puede volver a caminar pings sin fix.
--
-- Los DROP INDEX IF EXISTS de abajo sirven fuera de producción, o dentro
-- de una transacción. En prod no van así: Ops los corre a mano, uno por
-- uno y fuera de BEGIN, con CONCURRENTLY. SQL listo para copiar:
--
--   DROP INDEX CONCURRENTLY IF EXISTS "idx_telemetria_imei_gps_valido";
--   DROP INDEX CONCURRENTLY IF EXISTS "idx_telemetria_vehiculo_gps_valido";
--
-- CONCURRENTLY no puede compartir transacción con el migrator. Si un DROP
-- CONCURRENTLY queda a medias, repetir ese statement: IF EXISTS lo deja
-- en no-op cuando el índice ya no está.

DROP INDEX IF EXISTS "idx_telemetria_imei_gps_valido";
DROP INDEX IF EXISTS "idx_telemetria_vehiculo_gps_valido";
