-- Migration 0092 — enciende la medición de huella en las empresas
-- transportistas activas que la tenían apagada.
-- Decisión del PO del 2026-11-26 (chat), tras D1 de .specs/frente2-cierre:
-- las altas ya nacen con la medición encendida; esto la enciende en las
-- transportistas que ya existían. Se apaga en Empresa.
--
-- TOCA DATOS: UPDATE de empresas.carbon_measurement_enabled. Necesita el visto
-- del PO en el PR (CLAUDE.md). No cambia el esquema de empresas.
--
-- Deja registro de cada empresa que cambió en empresas_medicion_encendida_0092
-- para que la reversa (drizzle/down/0092_…down.sql) devuelva exactamente esas
-- a false. Idempotente: correrla dos veces no cambia nada más.

CREATE TABLE IF NOT EXISTS empresas_medicion_encendida_0092 (
  empresa_id uuid PRIMARY KEY REFERENCES empresas (id) ON DELETE CASCADE,
  encendida_en timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

COMMENT ON TABLE empresas_medicion_encendida_0092 IS
  'Empresas a las que la migración 0092 encendió la medición de huella (carbon_measurement_enabled). La usa la reversa.';
--> statement-breakpoint

INSERT INTO empresas_medicion_encendida_0092 (empresa_id)
SELECT id
  FROM empresas
 WHERE es_transportista = true
   AND estado = 'activa'
   AND carbon_measurement_enabled = false
ON CONFLICT (empresa_id) DO NOTHING;
--> statement-breakpoint

UPDATE empresas
   SET carbon_measurement_enabled = true
 WHERE id IN (SELECT empresa_id FROM empresas_medicion_encendida_0092)
   AND carbon_measurement_enabled = false;
