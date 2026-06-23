-- Migration 0046 — tabla sugerencias_ruta (eco-routing realtime)
--
-- Persiste el ciclo de vida de cada sugerencia de ruta eco-óptima emitida
-- por el eco-routing-service (Task 6) en tiempo real durante un viaje activo:
--   emitida → entregada al conductor → evaluada (adoptada o rechazada)
--
-- El adoption-resolver (Task 8) resuelve el campo `adoptada` usando señales
-- de telemetría (el conductor tomó la ruta sugerida) o tiempo sin respuesta.
--
-- Expand-only (ADR-066): CREATE TABLE + CREATE INDEX. Sin DROP, sin RENAME,
-- sin SET NOT NULL retroactivo. El rollback de código (Cloud Run revision
-- anterior) es seguro: la versión previa desconoce esta tabla y la ignora.
-- Reversibilidad: ver down/0046_sugerencias_ruta.down.sql.

CREATE TABLE IF NOT EXISTS sugerencias_ruta (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- FK a viajes. CASCADE: si el viaje se elimina, sus sugerencias también.
  viaje_id              uuid        NOT NULL
                          REFERENCES viajes(id) ON DELETE CASCADE,
  -- Timestamp de emisión por el eco-routing-service.
  emitida_en            timestamptz NOT NULL,
  -- Polyline codificado de la ruta alternativa (Google Polyline format).
  polyline_alternativa  text        NOT NULL,
  -- Diferencia de ETA en segundos vs. baseline. Negativo = más rápida.
  delta_eta_segundos    integer     NOT NULL,
  -- Diferencia de CO2e en kg vs. baseline. Negativo = menos emisiones.
  -- numeric(10,3): hasta 9.999.999 kg con 3 decimales de precisión.
  delta_co2e_kg         numeric(10,3) NOT NULL,
  -- ETA de la ruta baseline en segundos (punto de referencia).
  eta_baseline_segundos integer     NOT NULL,
  -- Posición del vehículo al emitir la sugerencia.
  -- numeric(9,6): ±DDD.DDDDDD (~11 cm de precisión).
  posicion_lat          numeric(9,6)  NOT NULL,
  posicion_lng          numeric(9,6)  NOT NULL,
  -- true = entregada al conductor vía WebSocket/push.
  entregada             boolean     NOT NULL DEFAULT false,
  -- true = adoptada, false = rechazada, NULL = pendiente de evaluación.
  adoptada              boolean,
  -- Timestamp de evaluación de adopción. NULL si aún pendiente.
  evaluada_adopcion_en  timestamptz,
  creado_en             timestamptz NOT NULL DEFAULT now(),
  actualizado_en        timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- Índice principal: consultas por viaje (eco-routing-service + API de detalle).
CREATE INDEX idx_sugerencias_ruta_viaje
  ON sugerencias_ruta(viaje_id);
--> statement-breakpoint

-- Índice parcial: adoption-resolver consulta solo sugerencias pendientes
-- (adoptada IS NULL) — evita scan full-table en la tabla de largo plazo.
CREATE INDEX idx_sugerencias_ruta_adopcion_pendiente
  ON sugerencias_ruta(viaje_id)
  WHERE adoptada IS NULL;
--> statement-breakpoint

COMMENT ON TABLE sugerencias_ruta IS
  'Sugerencias de ruta eco-óptima emitidas en tiempo real por el eco-routing-service. Ciclo de vida: emitida → entregada → evaluada (adoptada/rechazada). Ver migration 0046.';
--> statement-breakpoint

COMMENT ON COLUMN sugerencias_ruta.adoptada IS
  'true = adoptada, false = rechazada, NULL = pendiente de evaluación por el adoption-resolver (Task 8).';
--> statement-breakpoint

COMMENT ON COLUMN sugerencias_ruta.delta_co2e_kg IS
  'Diferencia de emisiones CO2e vs. ruta baseline (kg). Negativo = la ruta alternativa emite menos CO2.';
