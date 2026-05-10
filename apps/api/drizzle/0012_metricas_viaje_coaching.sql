-- Migration 0012 — Coaching IA en metricas_viaje (Phase 3 PR-J2)
--
-- Agrega 5 columnas para persistir el mensaje de coaching generado
-- post-entrega por @booster-ai/coaching-generator (PR-J1):
--
--   - coaching_mensaje: el texto (≤320 chars, cabe en SMS/WhatsApp)
--   - coaching_foco: bucket del feedback ('frenado' | 'aceleracion' |
--     'curvas' | 'velocidad' | 'felicitacion' | 'multiple') para
--     analytics
--   - coaching_fuente: 'gemini' | 'plantilla' (para distinguir cobertura
--     AI vs fallback determinístico)
--   - coaching_modelo: nombre del modelo (e.g. 'gemini-1.5-flash');
--     NULL si fuente='plantilla'
--   - coaching_generado_en: timestamp de generación
--
-- Persistir en lugar de recomputar evita re-pagar Gemini cada vez que
-- el carrier abre el detalle del trip. Re-generación solo en recálculo
-- explícito (admin o cron de re-emit).
--
-- Riesgo deploy: bajo. ADD COLUMN nullable es metadata-only en Postgres
-- ≥ 11. Reversible vía DROP COLUMN.

ALTER TABLE "metricas_viaje"
  ADD COLUMN "coaching_mensaje" text,
  ADD COLUMN "coaching_foco" varchar(20),
  ADD COLUMN "coaching_fuente" varchar(20),
  ADD COLUMN "coaching_modelo" varchar(50),
  ADD COLUMN "coaching_generado_en" timestamptz;
