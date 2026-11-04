-- Migration 0066 — alertas de la decisión de fuente de la huella (HC-001 wiring parte 2).
--
-- Expand-only: ADD COLUMN nullable, sin default, sin backfill. NULL = decisión
-- no registrada; '{}' = decisión sin alertas. Valores en ALERTAS_DECISION
-- (decidir-fuente-huella.ts), sin enum de Postgres.

ALTER TABLE metricas_viaje ADD COLUMN alertas_decision varchar(40)[];
