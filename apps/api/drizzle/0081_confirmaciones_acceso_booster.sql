-- Migration 0081 — confirmaciones del acceso al panel de Booster.
--
-- `.specs/confirmar-acceso-booster`: cuando el panel del personal da de alta
-- una cuenta que ya tiene clave y vínculos con una empresa, el acceso lo
-- confirma la persona desde su sesión con un código de 6 dígitos que el admin
-- de Booster le entrega en persona. Esta tabla guarda ese código solo como
-- hash, con su vencimiento (24 horas) y sus intentos fallidos (máximo 5).
-- Una sola confirmación pendiente por persona: emitir una nueva borra la
-- anterior, y el índice único parcial lo garantiza. Una confirmación consumida
-- queda como registro.
--
-- No reutiliza `usuarios.activacion_pin_hash` ni `usuarios.activacion_vence_en`:
-- esas columnas son el código de activación del panel.
--
-- Expand-only: tabla nueva, sin backfill. Una revisión previa la ignora.

CREATE TABLE IF NOT EXISTS confirmaciones_acceso_booster (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  codigo_hash text NOT NULL,
  vence_en timestamp with time zone NOT NULL,
  intentos_fallidos integer NOT NULL DEFAULT 0,
  emitido_por_usuario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  creado_en timestamp with time zone NOT NULL DEFAULT now(),
  consumido_en timestamp with time zone,
  CONSTRAINT chk_confirmaciones_acceso_booster_intentos CHECK (intentos_fallidos >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_confirmaciones_acceso_booster_pendiente
  ON confirmaciones_acceso_booster (usuario_id) WHERE consumido_en IS NULL;
