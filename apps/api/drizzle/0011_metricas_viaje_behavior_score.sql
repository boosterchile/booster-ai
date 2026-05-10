-- Migration 0011 — Driver behavior score en metricas_viaje (Phase 2 PR-I4)
--
-- Agrega 3 columnas al row de metricas existente para persistir el
-- score de conducción del trip + su breakdown. El cálculo lo hace
-- @booster-ai/driver-scoring (PR-I3) consumiendo eventos de
-- eventos_conduccion_verde (PR-I2). Persistir el resultado evita
-- recomputar en cada GET del dashboard.
--
-- Nullables porque:
--   - Trips sin Teltonika (Basic tier ADR-026) no producen eventos →
--     no hay score que computar.
--   - Trips legacy (pre-PR-I4) no tienen score hasta que pase un
--     recálculo. El recálculo se dispara automáticamente en
--     confirmar-entrega-viaje (PR-I4 wire).
--
-- Riesgo deploy: bajo. ADD COLUMN nullable es metadata-only en
-- Postgres ≥ 11. Reversible vía DROP COLUMN.

ALTER TABLE "metricas_viaje"
  ADD COLUMN "puntaje_conduccion" numeric(5, 2),
  ADD COLUMN "puntaje_conduccion_nivel" varchar(20),
  ADD COLUMN "puntaje_conduccion_desglose" jsonb;

-- Index para queries del dashboard ("top 10 transportistas por score
-- este mes" o "todos los trips con score < 50 que requieren coaching").
CREATE INDEX "idx_metricas_viaje_puntaje_conduccion"
  ON "metricas_viaje" ("puntaje_conduccion");
