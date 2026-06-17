-- 0041 — Índice compuesto para el hot path de matching (best-fit de vehículos)
-- Rama perf/matching-n1-and-index — complementa la eliminación del N+1 en
-- runMatching (apps/api/src/services/matching.ts): tras batchear el SELECT de
-- vehículos a una sola query, ésta filtra por
--   empresa_id IN (...) AND estado_vehiculo = 'activo' AND capacidad_kg >= X
--   ORDER BY capacidad_kg, id
-- El índice (empresa_id, estado_vehiculo, capacidad_kg, id) sirve esa forma
-- exacta: igualdad en empresa_id (IN) + estado_vehiculo, rango en capacidad_kg,
-- y entrega el orden (capacidad_kg, id) del best-fit determinista
-- (skill empty-leg-matching §7) sin sort adicional por empresa.
--
-- Idempotente (IF NOT EXISTS / IF EXISTS) por consistencia con el reset de
-- integration tests y reaplicaciones manuales. Rollback: ver al final.
CREATE INDEX IF NOT EXISTS "idx_vehiculos_empresa_estado_capacidad"
  ON "vehiculos" ("empresa_id", "estado_vehiculo", "capacidad_kg", "id");
--> statement-breakpoint

-- idx_vehiculos_empresa (single-column sobre empresa_id) queda redundante: el
-- compuesto de arriba lo cubre como prefijo (empresa_id es su columna líder),
-- así que toda query por empresa_id solo —incluido el check del FK
-- vehiculos.empresa_id → empresas(id)— sigue indexada por el prefijo. Mismo
-- criterio anti-redundancia que 0040 (índices redundantes pagan escritura sin
-- aportar lecturas no cubiertas). Rollback: recrear con
--   CREATE INDEX "idx_vehiculos_empresa" ON "vehiculos" ("empresa_id");
DROP INDEX IF EXISTS "idx_vehiculos_empresa";
