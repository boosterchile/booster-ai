-- 0040 — Integridad referencial + unique stakeholder + índices redundantes
-- Auditoría 2026-06-09 (spec .specs/fix-db-integridad-indices/).
--
-- (1) FK faltante: documentos_conductor.conductor_id no referenciaba
--     conductores(id) — único hueco de integridad en un modelo que usa
--     RESTRICT consistentemente. Si esta sentencia falla por huérfanos
--     preexistentes, diagnosticar con:
--       SELECT dc.id, dc.conductor_id FROM documentos_conductor dc
--       LEFT JOIN conductores c ON c.id = dc.conductor_id WHERE c.id IS NULL;
--     y resolver manualmente (NO se borra data en migraciones automáticas).
ALTER TABLE "documentos_conductor"
  ADD CONSTRAINT "fk_documentos_conductor_conductor"
  FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE RESTRICT;
--> statement-breakpoint

-- (2) Unique parcial para memberships stakeholder: el UNIQUE existente
--     (usuario_id, empresa_id) no cubre filas con empresa_id NULL
--     (NULL≠NULL en Postgres) — un user podía tener N memberships
--     duplicadas en la MISMA organización stakeholder. Parcial (no
--     NULLS NOT DISTINCT) para no bloquear memberships del mismo user
--     en organizaciones distintas.
CREATE UNIQUE INDEX "uq_membresias_usuario_org_stakeholder"
  ON "membresias"("usuario_id", "organizacion_stakeholder_id")
  WHERE "organizacion_stakeholder_id" IS NOT NULL;
--> statement-breakpoint

-- (3) Índices redundantes (telemetria_puntos pagaba 5 estructuras por
--     INSERT a ~2.16M filas/mes). Equality/prefijo quedan cubiertos por
--     los UNIQUE correspondientes; DESC vs ASC es irrelevante (btree se
--     escanea backward). Rollback: recrear con los CREATE INDEX de
--     0004/0005/0010.
DROP INDEX IF EXISTS "idx_telemetria_imei_ts";
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_telemetria_vehiculo_recibido";
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_eventos_conduccion_vehiculo_ts";
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_vehiculos_teltonika_imei";
