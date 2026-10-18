-- MANUAL-APPLY-ONLY. El auto-migrator no lee este directorio (ADR-066).
-- Revierte 0061 (mandato de cobro). Borra el historial de eventos de pago:
-- correrlo con eventos registrados en producción pierde evidencia del flujo
-- de dinero. Antes, exportar la tabla.

DROP TABLE IF EXISTS "eventos_pago_viaje";
DROP FUNCTION IF EXISTS "rechazar_cambio_evento_pago"();
DROP TYPE IF EXISTS "tipo_evento_pago";
ALTER TABLE "liquidaciones" DROP COLUMN IF EXISTS "modo_flujo";
DROP TYPE IF EXISTS "modo_flujo";
