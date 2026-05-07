-- Migration 0008 — Empty backhaul allocation en metricas_viaje (FIX-013a)
--
-- Agrega 3 columnas para persistir el resultado de calcularEmptyBackhaul()
-- del package @booster-ai/carbon-calculator (GLEC v3.0 §6.4 + ISO 14083).
--
-- Mapeo a la API del calculator:
--   factor_matching_aplicado            <- result.backhaul.factorMatchingAplicado
--   emisiones_empty_backhaul_kgco2e_wtw <- result.backhaul.emisionesKgco2eWtw
--   ahorro_co2e_vs_sin_matching_kgco2e  <- result.backhaul.ahorroVsSinMatchingKgco2e
--
-- Las 3 columnas son nullable porque:
--   - Filas pre-existentes en metricas_viaje no tienen cómo derivar estos
--     valores; el backfill se hará bajo demanda al recalcular cada viaje.
--   - factor_matching_aplicado puede ser null cuando el matching engine no
--     encuentra un trip de retorno candidato (ver §1.3 del handoff).
--   - Backhaul allocation aplica solo a viajes road-freight con retorno
--     conocido; multi-modal o intermodal queda fuera de scope inicial.
--
-- Riesgo de despliegue: bajo. ADD COLUMN nullable es metadata-only en
-- Postgres ≥ 11, así que es seguro correrlo en prod sin downtime y sin
-- re-write de filas existentes.

ALTER TABLE "metricas_viaje"
  ADD COLUMN "factor_matching_aplicado" numeric(3, 2),
  ADD COLUMN "emisiones_empty_backhaul_kgco2e_wtw" numeric(10, 3),
  ADD COLUMN "ahorro_co2e_vs_sin_matching_kgco2e" numeric(10, 3);
