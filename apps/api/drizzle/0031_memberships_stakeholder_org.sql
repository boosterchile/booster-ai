-- Migration 0031_memberships_stakeholder_org.sql
-- ADR-034 — Extiende memberships para soportar pertenencia XOR a
-- empresa O a organización stakeholder. Una membership pertenece a una
-- de las dos entidades, nunca a ambas, nunca a ninguna.
--
-- El CHECK constraint garantiza la invariante a nivel DB; el código
-- de aplicación lo asume y no necesita defenderse de estados inválidos.
--
-- Como `empresa_id` era NOT NULL, primero relajamos esa restricción y
-- después introducimos el CHECK XOR — el CHECK efectivamente reemplaza
-- el NOT NULL, pero permite el caso "stakeholder en lugar de empresa".

-- 1. Permitir empresa_id NULL (defendido por el CHECK más abajo).
ALTER TABLE membresias
  ALTER COLUMN empresa_id DROP NOT NULL;

-- 2. Nueva columna organizacion_stakeholder_id.
ALTER TABLE membresias
  ADD COLUMN organizacion_stakeholder_id uuid
    REFERENCES organizaciones_stakeholder(id) ON DELETE RESTRICT;

-- 3. CHECK XOR: la membership tiene exactamente una de las dos columnas
--    de entidad de pertenencia setada.
ALTER TABLE membresias
  ADD CONSTRAINT chk_membresia_empresa_xor_stakeholder
    CHECK (
      (empresa_id IS NOT NULL AND organizacion_stakeholder_id IS NULL)
      OR
      (empresa_id IS NULL AND organizacion_stakeholder_id IS NOT NULL)
    );

-- 4. Index para queries del estilo "todos los miembros del stakeholder X".
CREATE INDEX idx_membresias_org_stakeholder
  ON membresias (organizacion_stakeholder_id)
  WHERE organizacion_stakeholder_id IS NOT NULL;

-- 5. UNIQUE parcial: un mismo user no puede tener dos memberships en la
--    misma org stakeholder (mismo patrón que uq_membresias_usuario_empresa).
CREATE UNIQUE INDEX uq_membresias_usuario_org_stakeholder
  ON membresias (usuario_id, organizacion_stakeholder_id)
  WHERE organizacion_stakeholder_id IS NOT NULL;

COMMENT ON COLUMN membresias.organizacion_stakeholder_id IS
  'ADR-034 — Si setado, esta membership pertenece a una organización stakeholder y empresa_id es NULL (CHECK XOR).';
COMMENT ON CONSTRAINT chk_membresia_empresa_xor_stakeholder ON membresias IS
  'ADR-034 — Una membership pertenece a empresa O a organizacion_stakeholder, nunca a ambas, nunca a ninguna.';
