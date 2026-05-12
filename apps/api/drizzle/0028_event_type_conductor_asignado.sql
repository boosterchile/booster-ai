-- Migration 0028 — Agrega event type 'conductor_asignado' a tipo_evento_viaje.
--
-- Necesario para que el endpoint POST /assignments/:id/asignar-conductor
-- (creado para cerrar el flujo carrier → driver post-accept-offer) pueda
-- registrar audit event cuando el carrier asigna o cambia el conductor
-- de un assignment activo.
--
-- Diferente de 'asignacion_creada': ese evento se registra cuando el
-- carrier acepta la oferta y se crea el assignment (con driver_user_id
-- típicamente NULL). 'conductor_asignado' captura el segundo paso —
-- elegir QUE persona específica conducirá.
--
-- Riesgo deploy: ALTER TYPE ADD VALUE es DDL no transaccional pero
-- safe — el valor queda disponible inmediatamente para nuevos rows
-- sin afectar a los existentes.

ALTER TYPE tipo_evento_viaje ADD VALUE IF NOT EXISTS 'conductor_asignado';
