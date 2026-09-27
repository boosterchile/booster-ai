-- Migration 0057 — capacidad de estanque y fuente CAN de combustible por vehículo.
--
-- Brief P2 (2026-09-23): el cálculo de litros deja de adivinar el IO. La
-- fuente se provisiona por vehículo. sin_sensor (default) no inventa litros.
-- La capacidad, si se conoce, convierte el AVL 84 leído como porcentaje.
--
-- Expand-only (ADR-066): ADD COLUMN nullable. El DEFAULT de la fuente
-- rellena las filas existentes con sin_sensor en el ADD; no hay UPDATE
-- posterior, así un backfill manual de Data Ops no se pisa si la migración
-- ya corrió. Capacidad queda NULL. Una revisión previa ignora las columnas.
-- Reverse manual en drizzle/down/0057_vehiculos_estanque_fuente_can.down.sql.

ALTER TABLE vehiculos
  ADD COLUMN capacidad_estanque_l numeric(7, 2),
  ADD COLUMN fuente_combustible_can text DEFAULT 'sin_sensor';
--> statement-breakpoint

ALTER TABLE vehiculos
  ADD CONSTRAINT chk_vehiculos_capacidad_estanque_l
    CHECK (
      capacidad_estanque_l IS NULL
      OR (capacidad_estanque_l > 0 AND capacidad_estanque_l <= 2000)
    );
--> statement-breakpoint

ALTER TABLE vehiculos
  ADD CONSTRAINT chk_vehiculos_fuente_combustible_can
    CHECK (
      fuente_combustible_can IS NULL
      OR fuente_combustible_can IN ('84', '83', '89', 'sin_sensor')
    );
--> statement-breakpoint

COMMENT ON COLUMN vehiculos.capacidad_estanque_l IS
  'Litros del estanque. NULL = no declarada: no se convierten porcentajes CAN a litros. Rango (0, 2000].';
--> statement-breakpoint

COMMENT ON COLUMN vehiculos.fuente_combustible_can IS
  'IO CAN que el backend puede usar para combustible: 84 (nivel %), 83 (consumo acumulado), 89 (nivel %) o sin_sensor. NULL se lee como sin_sensor. No se infiere del censo.';
