-- MANUAL-APPLY-ONLY. El auto-migrator no lee este directorio (ADR-066).
-- Revierte 0066: saca los índices parciales de la última posición válida.
-- La lectura vuelve al índice general y puede volver a caminar pings sin fix.

DROP INDEX IF EXISTS "idx_telemetria_imei_gps_valido";
DROP INDEX IF EXISTS "idx_telemetria_vehiculo_gps_valido";
