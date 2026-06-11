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

-- (2) [RETIRADO en review de CI 2026-06-11] El unique parcial
--     uq_membresias_usuario_org_stakeholder YA EXISTE desde la migración
--     0031_memberships_stakeholder_org.sql:39 con semántica idéntica —
--     el hallazgo de la auditoría era falso y recrearlo daba 42P07.
--     La constraint queda cubierta por 0031; el integration test
--     integridad-0040 la valida como regresión (da igual qué migración
--     la creó).

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
