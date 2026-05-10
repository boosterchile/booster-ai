-- Admin platform-wide UI para Cobra Hoy (ADR-029 v1 / ADR-032).
--
-- Agrega `notas_admin` (texto append-only construido en API con tag
-- [ts admin_email]) al adelanto para registrar comentarios libres del
-- operador en cada transición. No reemplaza `rechazo_motivo` (campo
-- semánticamente acotado a 'rechazado'/'cancelado').

ALTER TABLE adelantos_carrier ADD COLUMN notas_admin text;
