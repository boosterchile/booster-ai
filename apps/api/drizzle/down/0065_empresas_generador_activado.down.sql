-- MANUAL-APPLY-ONLY. El auto-migrator no lee este directorio (ADR-066).
-- Revierte 0065. El flag `es_generador_carga` no se toca: solo se pierde
-- quién y cuándo lo prendió el platform-admin.

ALTER TABLE "empresas" DROP COLUMN IF EXISTS "generador_carga_activado_por";
ALTER TABLE "empresas" DROP COLUMN IF EXISTS "generador_carga_activado_en";
