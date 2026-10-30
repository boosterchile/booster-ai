-- Migration 0065 — vencimiento del código de activación en la cuenta.
--
-- El alta del personal de Booster desde el panel (.specs/alta-personal-booster)
-- emite un código de un solo uso sin invitación a una empresa, así que
-- `/auth/activar` no tiene un `membresias.invitado_en` del que sacar el plazo
-- de 7 días. Esta columna lo guarda en la cuenta. Se borra al activar.
--
-- Expand-only: ADD COLUMN timestamptz nullable, sin default ni backfill.
-- Ninguna fila existente cambia y una revisión previa ignora la columna.

ALTER TABLE usuarios
  ADD COLUMN activacion_vence_en timestamp with time zone;
