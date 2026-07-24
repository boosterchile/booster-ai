-- Migration 0053 — bitacora_backfill_distancia: journal de reversibilidad del
-- backfill de re-derivación de distancia real (F0-0 paso 1, spec
-- .specs/distancia-real-hibrida/). El backfill reescribe datos ya existentes
-- (cobertura_pct pasa al denominador nuevo §5-ext); esta bitácora guarda el
-- before-state ANTES de sobrescribir → camino de vuelta programático.
--
-- Registra CADA trip procesado en write mode (no solo los escritos):
--   - before-state: cobertura_pct/nivel/distancia ANTES (para revert).
--   - after-state:  cobertura_pct/nivel/distancia DESPUES (null si abortó).
--   - motivo_abort: por qué NO se reconstruyó (null si se escribió) — diagnóstico
--     de qué trips no se pudieron reconstruir y por qué.
--   - llamadas_routes: costo real por trip (atribuir cuota, detectar patológicos).
--
-- ⚠️ TABLA TEMPORAL — FECHA DE RETIRO: DROP una vez que el backfill esté
--    consolidado (corrió en prod + certs afectados re-emitidos/verificados +
--    cerrada la ventana de revert de 30 días). Backstop: 2026-09-30 (revisar en
--    el cierre del frente F0-0). Detalle en adr-028-ext-movil-gps-propuesta.md.
--    NO dejar esta tabla indefinidamente — si no se retira, se vuelve deuda
--    permanente (justo el problema que evitó no meter una columna en metricas_viaje).
--
-- Sin FK a viajes: journal throwaway, la integridad referencial no aporta y sí
-- acopla/arriesga. Expand-only (ADR-066): solo CREATE TABLE + CREATE INDEX.
-- Reverse manual en drizzle/down/0053_bitacora_backfill_distancia.down.sql.

CREATE TABLE "bitacora_backfill_distancia" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "viaje_id" uuid NOT NULL,
  "cobertura_pct_antes" numeric(5, 2),
  "nivel_certificacion_antes" "nivel_certificacion",
  "distancia_km_real_antes" numeric(10, 2),
  "cobertura_pct_despues" numeric(5, 2),
  "nivel_certificacion_despues" "nivel_certificacion",
  "distancia_km_real_despues" numeric(10, 2),
  "motivo_abort" varchar(20),
  "llamadas_routes" integer DEFAULT 0 NOT NULL,
  "procesado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX "idx_bitacora_backfill_distancia_viaje"
  ON "bitacora_backfill_distancia" USING btree ("viaje_id");
--> statement-breakpoint

CREATE INDEX "idx_bitacora_backfill_distancia_procesado"
  ON "bitacora_backfill_distancia" USING btree ("procesado_en");
