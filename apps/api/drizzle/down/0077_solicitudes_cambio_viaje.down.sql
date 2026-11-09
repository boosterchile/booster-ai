-- =============================================================================
-- Revierte la migración 0077 (solicitudes de cambio de una carga asignada).
--
-- Borra el historial de solicitudes. Los eventos cambio_solicitado y
-- cambio_respondido de eventos_viaje quedan con un solicitud_id huérfano.
-- En prod conviene el rollback de código: una revisión previa no lee la tabla.
-- Si hubiera solicitudes pendientes, una revisión previa no bloquea la
-- recogida: el conductor recogería con los datos originales, que son los
-- vigentes.
--
-- Aplicar a mano vía bastion en modo password (DDL):
--   AUTH_MODE=password bash scripts/db/connect.sh -f apps/api/drizzle/down/0077_solicitudes_cambio_viaje.down.sql
--
-- ⚠️ NO actualiza drizzle.__drizzle_migrations: si la migración forward sigue en
--    el repo, el próximo startup la re-aplica. Parche puente, no undo permanente.
-- =============================================================================

DROP TABLE IF EXISTS solicitudes_cambio_viaje;
DROP TYPE IF EXISTS estado_solicitud_cambio;
