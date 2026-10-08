-- MANUAL-APPLY-ONLY. El auto-migrator no lee este directorio (ADR-066).
-- Revierte 0059: elimina la tabla de sugerencias de eco-routing y sus enums.
-- Destruye el historial de sugerencias/respuestas: exportar antes si se usa.

DROP TABLE IF EXISTS "sugerencias_ruta";
DROP TYPE IF EXISTS "respuesta_sugerencia_ruta";
DROP TYPE IF EXISTS "motivo_sugerencia_ruta";
DROP TYPE IF EXISTS "estado_sugerencia_ruta";
