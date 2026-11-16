-- Migration 0085 — viajes propios del transportista (BARH-24).
-- Expand-only: marca de origen, cliente externo, oferta nullable en asignaciones.
-- Spec: `.specs/viaje-propio-transportista/`. Sin matching ni ofertas.

ALTER TABLE viajes
  ADD COLUMN IF NOT EXISTS origen_alta text NOT NULL DEFAULT 'marketplace';

ALTER TABLE viajes
  ADD COLUMN IF NOT EXISTS cliente_externo_nombre text;

ALTER TABLE viajes
  ADD COLUMN IF NOT EXISTS cliente_externo_rut text;

ALTER TABLE viajes
  ADD COLUMN IF NOT EXISTS cliente_externo_contacto text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_viajes_origen_alta'
  ) THEN
    ALTER TABLE viajes
      ADD CONSTRAINT ck_viajes_origen_alta
      CHECK (origen_alta IN ('marketplace', 'propio_transportista'));
  END IF;
END $$;

-- propio + generador registrado: externos NULL; propio + externo: nombre NOT NULL
-- y generador NULL. marketplace: sin restricción adicional (sigue permitiendo
-- drafts WhatsApp sin generador).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_viajes_cliente_propio'
  ) THEN
    ALTER TABLE viajes
      ADD CONSTRAINT ck_viajes_cliente_propio
      CHECK (
        origen_alta = 'marketplace'
        OR (
          origen_alta = 'propio_transportista'
          AND (
            (
              generador_carga_empresa_id IS NOT NULL
              AND cliente_externo_nombre IS NULL
              AND cliente_externo_rut IS NULL
              AND cliente_externo_contacto IS NULL
            )
            OR (
              generador_carga_empresa_id IS NULL
              AND cliente_externo_nombre IS NOT NULL
            )
          )
        )
      );
  END IF;
END $$;

-- Viaje propio no crea oferta: allow NULL en asignaciones.oferta_id.
ALTER TABLE asignaciones
  ALTER COLUMN oferta_id DROP NOT NULL;
