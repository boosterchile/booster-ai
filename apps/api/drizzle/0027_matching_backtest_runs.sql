-- Migration 0027 — Matching v2 backtest runs (ADR-033 §8)
--
-- Tabla que persiste corridas de backtest del matching engine v2 contra
-- trips históricos. Comparamos lado-a-lado: con `MATCHING_ALGORITHM_V2_ACTIVATED=true`
-- vs el algoritmo v1 capacity-only que se usó originalmente para el trip.
--
-- Audiencia primaria: platform admins (operadores Booster) que evalúan si
-- el v2 mejora distribución de ofertas a transportistas antes de activar
-- el flag en producción.
--
-- Diseño:
--
--   1. **Una fila por corrida**, no por trip. El detalle de cada trip
--      backtested va en `resultados` (JSONB). Razones:
--      - Una corrida típica analiza 100-1000 trips; mantener tabla
--        relacional separada sería over-engineering en MVP.
--      - El acceso es siempre "ver una corrida con todos sus resultados",
--        nunca "buscar un trip individual cruzando varias corridas".
--      - Si crece la necesidad, se splittea sin pérdida (resultados.id ya
--        es UUID por entrada).
--
--   2. **`pesos_usados`** JSONB persiste los `WeightsV2` de esa corrida
--      — permite comparar el efecto de A/B testing de pesos sin
--      ambigüedad.
--
--   3. **`metricas_resumen`** JSONB pre-computado al cerrar la corrida:
--      - candidatesEvaluatedTotal
--      - topNOverlapPct (qué % de ofertas v2 coinciden con v1)
--      - scoreDeltaAvg (delta promedio v2 vs v1, signed)
--      - backhaulHitRate (% trips con al menos 1 candidato v2 con
--        tripActivoDestinoRegionMatch=true)
--      - empresasFavorecidas / empresasPerjudicadas (top-3 movers)
--      - distribucionRangoScores (histogram buckets [0-200, 200-400, ...])
--
--   4. **`estado` persistido** (pendiente|ejecutando|completada|fallida)
--      con `error_message` para corridas que crashearon mid-flight.
--      Permite reanudar / re-disparar sin scan del log.
--
--   5. **`created_by_email`** snapshotted (no FK a users) — el operador
--      humano que disparó. Si ese user es borrado, la corrida queda
--      atribuible. Auditabilidad > integridad referencial acá.
--
-- Riesgo deploy: CREATE TABLE + CREATE TYPE nuevos. Idempotente con
-- IF NOT EXISTS. Cero downtime, cero risk a tráfico existente.

CREATE TYPE estado_backtest_run AS ENUM (
  'pendiente',
  'ejecutando',
  'completada',
  'fallida'
);

CREATE TABLE matching_backtest_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Metadata de origen.
  created_by_email varchar(255) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,

  -- Rango temporal del muestreo. NULL en ambos lados = todos los trips
  -- en estado terminal (ofertas_enviadas | asignado | en_proceso | finalizado | expirado).
  trips_desde timestamptz,
  trips_hasta timestamptz,

  -- Ceiling para evitar runs de millones de trips por error operador.
  -- Hard-cap 5000; el servicio aplica el limit en query.
  trips_limit integer NOT NULL DEFAULT 500 CHECK (trips_limit BETWEEN 1 AND 5000),

  -- Pesos custom probados (si NULL, usa DEFAULT_WEIGHTS_V2).
  pesos_usados jsonb,

  -- Estado de la corrida + error si falló.
  estado estado_backtest_run NOT NULL DEFAULT 'pendiente',
  error_message text,

  -- Conteos de control (set al terminar).
  trips_procesados integer NOT NULL DEFAULT 0,
  trips_con_candidatos_v2 integer NOT NULL DEFAULT 0,
  trips_con_candidatos_v1 integer NOT NULL DEFAULT 0,

  -- Resultado pre-computado: shape definido en matching-backtest.ts
  -- (MetricasResumen). UI lo consume directo sin recomputar.
  metricas_resumen jsonb,

  -- Detalle por trip — array de objetos { tripId, ofertasV1, ofertasV2,
  --                                       overlap, scoresV1, scoresV2 }.
  -- Capped en service-side a `trips_limit` para no crecer sin bound.
  resultados jsonb
);

CREATE INDEX idx_matching_backtest_runs_estado ON matching_backtest_runs (estado);
CREATE INDEX idx_matching_backtest_runs_created_at ON matching_backtest_runs (created_at DESC);
CREATE INDEX idx_matching_backtest_runs_created_by ON matching_backtest_runs (created_by_email);

-- RLS: solo se accede vía API con auth de platform-admin. No habilitamos
-- RLS porque no es multi-tenant (tabla global). La gate de auth ocurre
-- en la capa de routes (BOOSTER_PLATFORM_ADMIN_EMAILS allowlist).

COMMENT ON TABLE matching_backtest_runs IS
  'ADR-033 §8 — Corridas de backtest comparando matching v1 vs v2 sobre trips históricos. Audiencia: platform admins.';
