-- MANUAL-APPLY-ONLY. El auto-migrator no lee este directorio (ADR-066).
-- Revierte 0059 (modelo comercial v3). Solo seguro mientras
-- PRICING_V3_ACTIVATED = false: con el flag encendido estas columnas ya
-- tienen datos de liquidación y revertir los pierde (usar PITR, ver
-- docs/runbooks/db-migration-rollback.md).
--
-- tier_slug_aplicado vuelve a NOT NULL solo si no hay liquidaciones v3.

ALTER TABLE "facturas_booster_clp" DROP COLUMN IF EXISTS "uf_valor_clp";
ALTER TABLE "facturas_booster_clp" DROP COLUMN IF EXISTS "monto_uf";
ALTER TABLE "liquidaciones" ALTER COLUMN "tier_slug_aplicado" SET NOT NULL;
ALTER TABLE "liquidaciones" DROP COLUMN IF EXISTS "configuracion_comercial_id";
ALTER TABLE "liquidaciones" DROP COLUMN IF EXISTS "modalidad_carga";
ALTER TABLE "liquidaciones" DROP COLUMN IF EXISTS "total_factura_generador_clp";
ALTER TABLE "liquidaciones" DROP COLUMN IF EXISTS "precio_generador_clp";
ALTER TABLE "liquidaciones" DROP COLUMN IF EXISTS "precio_transportista_clp";
ALTER TABLE "empresas" DROP COLUMN IF EXISTS "contrato_programado_activado_por";
ALTER TABLE "empresas" DROP COLUMN IF EXISTS "contrato_programado_activado_en";
ALTER TABLE "viajes" DROP COLUMN IF EXISTS "configuracion_comercial_id";
ALTER TABLE "viajes" DROP COLUMN IF EXISTS "comision_pct_aplicada";
ALTER TABLE "viajes" DROP COLUMN IF EXISTS "modalidad_carga";
DROP TABLE IF EXISTS "configuracion_comercial";
DROP TYPE IF EXISTS "modalidad_carga";
