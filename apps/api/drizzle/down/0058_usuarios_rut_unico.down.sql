-- MANUAL-APPLY-ONLY. El auto-migrator no lee este directorio (ADR-066).
-- Vuelve al índice no único. No toca filas.

DROP INDEX IF EXISTS "uq_usuarios_rut";
CREATE INDEX IF NOT EXISTS "idx_usuarios_rut" ON "usuarios" ("rut");
