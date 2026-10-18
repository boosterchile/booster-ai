-- MANUAL-APPLY-ONLY. El auto-migrator no lee este directorio (ADR-066).
-- Revierte 0060 (suscripciones en UF). Las facturas ya emitidas conservan
-- su monto_uf y uf_valor_clp (columnas de 0059); solo se pierde la caché
-- de valores UF y la marca de gestión de flota por empresa.

ALTER TABLE "empresas" DROP COLUMN IF EXISTS "gestion_flota_activada_por";
ALTER TABLE "empresas" DROP COLUMN IF EXISTS "gestion_flota_activada_en";
DROP TABLE IF EXISTS "valores_uf";
