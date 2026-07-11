-- Migration 0050 — empresas.es_usuario_prueba: marca de empresa de usuarios de
-- prueba para impersonación auditada, DESACOPLADA de es_demo (ADR-053 + recon
-- findings .specs/impersonacion-auditada/findings.md).
--
-- Motivo: el picker de impersonación y el write-guard keyeaban en `es_demo`,
-- que acopla a la superficie /demo/login (origen del vector #206) + al
-- lifecycle demo (retire/TTL). Este flag nuevo NO es login-reachable por
-- ninguna superficie pública (no lo lee demo-login.ts) — solo lo consumen el
-- targets query (admin-gated) y el write-guard. Así los usuarios de prueba de
-- impersonación quedan fuera del subsistema demo moribundo y del vector de
-- credencial compartida.
--
-- Expand-only (ADR-066): solo ADD COLUMN con DEFAULT. Materializa en catálogo
-- (Postgres 11+, sin reescritura bloqueante de filas). El rollback de la
-- revisión Cloud Run es seguro (una revisión previa ignora la columna).
-- Reverse manual en drizzle/down/0050_empresas_es_usuario_prueba.down.sql.

ALTER TABLE empresas
  ADD COLUMN es_usuario_prueba boolean NOT NULL DEFAULT false;
--> statement-breakpoint

COMMENT ON COLUMN empresas.es_usuario_prueba IS
  'Impersonación auditada: única marca que autoriza escritura de sesión impersonada (write-guard) y que el picker lista como target. Desacoplada de es_demo (ADR-053): NO expuesta a /demo/login ni al lifecycle demo.';
