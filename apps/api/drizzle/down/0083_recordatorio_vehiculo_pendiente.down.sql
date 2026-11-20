-- Reverso MANUAL de 0083 (el migrator es forward-only, ADR-066).
-- Seguro en cualquier momento: solo elimina columnas de marca de aviso.

ALTER TABLE "asignaciones" DROP COLUMN IF EXISTS "aviso_generador_sin_vehiculo_en";
ALTER TABLE "asignaciones" DROP COLUMN IF EXISTS "recordatorio_vehiculo_2h_en";
ALTER TABLE "asignaciones" DROP COLUMN IF EXISTS "recordatorio_vehiculo_24h_en";
