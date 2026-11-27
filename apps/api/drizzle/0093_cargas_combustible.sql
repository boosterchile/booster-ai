-- Migration 0093 — cargas_combustible: registro de cargas de combustible.
-- Spec: .specs/registro-cargas-combustible/spec.md (decisión D4 del PO,
-- 2026-11-27).
--
-- La empresa (o Booster impersonando) registra los litros cargados a cada
-- camión con su fecha y hora. Con eso Booster compara lo cargado contra lo
-- que quemó el motor (IO 83): la única medida que ve pérdidas de 10–20 L.
-- Anular no borra: queda anulada_en / anulada_por. La fecha se guarda truncada
-- al minuto por el api, así el índice único detecta la misma carga dos veces.
--
-- Expand-only (ADR-066): tabla nueva, ninguna existente cambia. Una revisión
-- previa del api la ignora.
-- Reverse manual en drizzle/down/0093_cargas_combustible.down.sql.

CREATE TABLE IF NOT EXISTS cargas_combustible (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  vehiculo_id uuid NOT NULL REFERENCES vehiculos(id) ON DELETE RESTRICT,
  cargada_en timestamp with time zone NOT NULL,
  litros numeric(7, 1) NOT NULL,
  lugar varchar(200),
  registrada_por uuid REFERENCES usuarios(id) ON DELETE RESTRICT,
  registrada_en timestamp with time zone NOT NULL DEFAULT now(),
  anulada_en timestamp with time zone,
  anulada_por uuid REFERENCES usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT chk_cargas_combustible_litros CHECK (litros > 0 AND litros <= 2000)
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS uq_cargas_combustible_vigente
  ON cargas_combustible (vehiculo_id, cargada_en, litros)
  WHERE anulada_en IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_cargas_combustible_vehiculo_fecha
  ON cargas_combustible (vehiculo_id, cargada_en DESC);
--> statement-breakpoint

COMMENT ON TABLE cargas_combustible IS
  'Cargas de combustible registradas por la empresa o por Booster (litros, fecha y hora, lugar). Se comparan contra el consumo del motor (IO 83). Anular deja anulada_en; no se borra.';
