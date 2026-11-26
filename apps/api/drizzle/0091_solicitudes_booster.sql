-- Migration 0091 — solicitudes_booster: «Pedir a Booster».
-- Spec: .specs/frente2-cierre/spec.md §3.4 (decisión D3 del PO, 2026-11-26).
--
-- El dueño de una flota deja de editar la fuente CAN de combustible: la
-- configura el personal de Booster. Desde Booster Fleet o la ficha del
-- vehículo, la empresa pide la configuración; la solicitud queda abierta hasta
-- que el personal de Booster la marca resuelta desde su panel (quién y cuándo).
-- Una sola solicitud abierta por vehículo y tipo: pedir de nuevo devuelve la
-- misma.
--
-- Expand-only (ADR-066): tabla nueva, ninguna existente cambia. Una revisión
-- previa del api la ignora.
-- Reverse manual en drizzle/down/0091_solicitudes_booster.down.sql.

CREATE TABLE IF NOT EXISTS solicitudes_booster (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  vehiculo_id uuid REFERENCES vehiculos(id) ON DELETE RESTRICT,
  tipo text NOT NULL,
  estado text NOT NULL DEFAULT 'abierta',
  creada_por uuid REFERENCES usuarios(id) ON DELETE RESTRICT,
  creada_en timestamp with time zone NOT NULL DEFAULT now(),
  resuelta_en timestamp with time zone,
  resuelta_por uuid REFERENCES usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT chk_solicitudes_booster_tipo
    CHECK (tipo IN ('configurar_fuente_combustible')),
  CONSTRAINT chk_solicitudes_booster_estado
    CHECK (estado IN ('abierta', 'resuelta'))
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS uq_solicitudes_booster_vehiculo_tipo_abierta
  ON solicitudes_booster (vehiculo_id, tipo)
  WHERE estado = 'abierta';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_solicitudes_booster_empresa
  ON solicitudes_booster (empresa_id);
--> statement-breakpoint

COMMENT ON TABLE solicitudes_booster IS
  'Solicitudes de configuración de una empresa al personal de Booster («Pedir a Booster»). Una abierta por vehículo y tipo; el personal la marca resuelta desde el panel.';
