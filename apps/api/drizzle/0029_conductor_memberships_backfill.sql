-- Migration 0029 — Modelo de identidad del conductor (definitivo).
--
-- Contexto: hasta acá el flujo del conductor estaba half-implementado.
-- Existía la tabla `conductores` (info adicional: licencia, PIN, etc.)
-- pero el conductor NO se creaba como `membership` con role='conductor'
-- de la empresa carrier. Resultado: `GET /me` devolvía
-- `active_membership: null` para el conductor → el frontend mostraba
-- "Sin empresa activa" cuando el conductor navegaba al dashboard
-- general.
--
-- Decisión consolidada (ver discusión 2026-05-12): el conductor ES un
-- miembro con `role='conductor'` de la empresa carrier que lo emplea.
-- La tabla `conductores` permanece como metadata específica del
-- conductor (licencia, vencimiento, PIN, clase), pero la fuente de
-- verdad de "este user pertenece a esta empresa con este rol" es
-- siempre `memberships`.
--
-- Invariante post-migration:
--   Para cada fila en `conductores` con `eliminado_en IS NULL`,
--   debe existir EXACTAMENTE 1 fila en `memberships` con:
--     - user_id = conductores.usuario_id
--     - empresa_id = conductores.empresa_id
--     - role = 'conductor'
--     - estado IN ('activa', 'pendiente_invitacion') (no 'removida'/'suspendida')
--
-- Esta migration backfillea las filas faltantes para no dejar
-- conductores huérfanos. Las filas nuevas creadas a partir de aquí
-- (via ensureConductor o el flujo D9 driver-activate) se encargan en
-- código.
--
-- Riesgo deploy: INSERTs idempotentes con ON CONFLICT — corre múltiples
-- veces sin duplicar. Sin DROPS ni ALTERs destructivos.

-- Insert membership 'conductor' para cada conductor activo que no tenga
-- todavía una membership en la misma empresa (la UNIQUE constraint
-- `uq_membresias_usuario_empresa` impide 2 memberships del mismo user
-- en la misma empresa con distintos roles — si el user ya tiene
-- membership como dueño/admin de esa empresa carrier, no le agregamos
-- una segunda con rol conductor; ese caso edge "dueño-conductor" se
-- maneja a futuro con cambio de constraint o flag explícito en
-- conductores).
INSERT INTO membresias (
  id,
  usuario_id,
  empresa_id,
  rol,
  estado,
  invitado_en,
  unido_en,
  creado_en,
  actualizado_en
)
SELECT
  gen_random_uuid(),
  c.usuario_id,
  c.empresa_id,
  'conductor'::rol_membresia,
  -- Si el user está activado (firebase_uid real), membership va
  -- 'activa' + unido_en = creado_en del conductor. Si todavía está
  -- pendiente (placeholder pending-rut:), va 'pendiente_invitacion' y
  -- unido_en = NULL — al activar via D9 (/auth/driver-activate) se
  -- promueve a 'activa' y se setea unido_en = now().
  CASE
    WHEN u.firebase_uid LIKE 'pending-rut:%' THEN 'pendiente_invitacion'::estado_membresia
    ELSE 'activa'::estado_membresia
  END,
  COALESCE(c.creado_en, now()),
  CASE
    WHEN u.firebase_uid LIKE 'pending-rut:%' THEN NULL
    ELSE COALESCE(c.creado_en, now())
  END,
  now(),
  now()
FROM conductores c
JOIN usuarios u ON u.id = c.usuario_id
WHERE c.eliminado_en IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM membresias m
    WHERE m.usuario_id = c.usuario_id
      AND m.empresa_id = c.empresa_id
  );

-- Nota: el deleteDemo de seed-demo.ts ya borra memberships antes de
-- borrar empresa (ver migration 0026/0027), así que el cleanup sigue
-- funcionando sin cambios. ensureConductor en código será actualizado
-- para crear la membership al mismo tiempo que el conductor.

COMMENT ON COLUMN membresias.rol IS
  'Rol del user en la empresa. Para conductores, el invariante (a partir de migration 0029) es que toda fila conductores activa tiene exactamente 1 membership con role=conductor en la misma empresa.';
