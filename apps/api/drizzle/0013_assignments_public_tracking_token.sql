-- Migration 0014 — Token público de tracking del consignee (Phase 5 PR-L1)
--
-- Añade `tracking_token_publico` UUID UNIQUE a la tabla `asignaciones`
-- para habilitar el caso "Uber-like": cuando un trip se asigna, el
-- generador de carga + opcional consignee reciben un link público
-- al endpoint GET /public/tracking/:token donde pueden ver el progreso
-- del viaje sin auth.
--
-- Diseño:
--   - UUID v4 random — opaco, no enumerable, no leakea info del trip
--   - UNIQUE — un token por assignment; si se filtra, lo invalidas con
--     un UPDATE (futuro PR rotación)
--   - NULLABLE para backwards-compat con assignments existentes
--     (se generan en el INSERT de futuras assignments, los viejos
--     quedan sin link y la PWA cae al flujo legacy)
--   - Index unique para lookup constante O(log n)
--
-- Riesgo deploy: bajo. ADD COLUMN nullable es metadata-only en Postgres
-- ≥ 11. Reversible vía DROP COLUMN.
--
-- Por qué token y no signed JWT:
--   - JWT exige rotación de signing key (operacional ruido). Token UUID
--     en DB es revocable con DELETE/UPDATE.
--   - JWT carga claims (timestamps) que no necesitamos — el lookup contra
--     DB ya da fresh status.
--   - Para tracking público, opacidad > self-contained. Si el token se
--     filtra en logs públicos, lo rotamos sin tocar otros sistemas.

ALTER TABLE "asignaciones"
  ADD COLUMN "tracking_token_publico" uuid;

CREATE UNIQUE INDEX "idx_asignaciones_tracking_token"
  ON "asignaciones" ("tracking_token_publico")
  WHERE "tracking_token_publico" IS NOT NULL;
