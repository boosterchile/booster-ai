-- Migration 0084 — invitaciones por correo a UI de creación de cuenta.
--
-- ADR-093 / `.specs/auth-correo-clave-booster-stakeholder`: el admin invita
-- con el correo; la persona consigna datos y clave Firebase en `/crear-cuenta`.
-- Token one-shot solo como hash; From canónico contacto@. Expand-only.

CREATE TABLE IF NOT EXISTS invitaciones_correo_cuenta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar(255) NOT NULL,
  tipo text NOT NULL,
  token_hash text NOT NULL,
  expira_en timestamp with time zone NOT NULL,
  consumido_en timestamp with time zone,
  emitido_por_usuario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  organizacion_stakeholder_id uuid REFERENCES organizaciones_stakeholder(id) ON DELETE RESTRICT,
  creado_en timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT chk_invitaciones_correo_cuenta_tipo
    CHECK (tipo IN ('personal_booster', 'stakeholder')),
  CONSTRAINT chk_invitaciones_correo_cuenta_stakeholder_org
    CHECK (
      (tipo = 'personal_booster' AND organizacion_stakeholder_id IS NULL)
      OR (tipo = 'stakeholder' AND organizacion_stakeholder_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_invitaciones_correo_cuenta_token_hash
  ON invitaciones_correo_cuenta (token_hash);

CREATE UNIQUE INDEX IF NOT EXISTS uq_invitaciones_correo_cuenta_email_pendiente
  ON invitaciones_correo_cuenta (email)
  WHERE consumido_en IS NULL;

CREATE INDEX IF NOT EXISTS idx_invitaciones_correo_cuenta_expira
  ON invitaciones_correo_cuenta (expira_en)
  WHERE consumido_en IS NULL;
