-- 0042 — Índice compuesto para el histórico 7d de matching v2 (audit P1-K)
-- lookupCarriersForV2 (apps/api/src/services/matching-v2-lookups.ts) agrega por
-- empresa el histórico de los últimos 7 días:
--   SELECT empresa_id, count(*), sum(case ...)
--   FROM asignaciones
--   JOIN viajes ON viajes.id = asignaciones.viaje_id
--   WHERE empresa_id IN (...) AND entregado_en >= now() - interval '7 days'
--   GROUP BY empresa_id
-- El índice (empresa_id, entregado_en) sirve esa forma: igualdad sobre
-- empresa_id (IN) + rango sobre entregado_en → index range scan por empresa,
-- sin escanear asignaciones antiguas. Con histórico grande la query pasa de
-- seq scan O(n) a O(filas de las empresas candidatas en la ventana).
--
-- Idempotente (IF NOT EXISTS / IF EXISTS). Rollback: ver al final.
CREATE INDEX IF NOT EXISTS "idx_asignaciones_empresa_entregado"
  ON "asignaciones" ("empresa_id", "entregado_en");
--> statement-breakpoint

-- idx_asignaciones_empresa (single-column sobre empresa_id) queda redundante: el
-- compuesto de arriba lo cubre como prefijo (empresa_id es su columna líder),
-- así que toda query por empresa_id solo —incluido el check del FK
-- asignaciones.empresa_id → empresas(id)— sigue indexada por el prefijo. Mismo
-- criterio anti-redundancia que 0040/0041. Rollback: recrear con
--   CREATE INDEX "idx_asignaciones_empresa" ON "asignaciones" ("empresa_id");
DROP INDEX IF EXISTS "idx_asignaciones_empresa";
