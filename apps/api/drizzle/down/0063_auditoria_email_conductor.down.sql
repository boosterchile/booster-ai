-- MANUAL-APPLY-ONLY. El auto-migrator no lee este directorio (ADR-066).
-- Revierte 0063: elimina la auditoría de correcciones del email del conductor.
-- Destruye el historial de cambios de email: exportar antes si se usa.

DROP TABLE IF EXISTS "auditoria_email_conductor";
