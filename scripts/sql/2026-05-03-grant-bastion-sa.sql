-- =============================================================================
-- 2026-05-03 — GRANT al rol IAM SA del bastion (ADR-014)
-- =============================================================================
-- Cuando cloud-sql-proxy en el bastion corre con --auto-iam-authn, todas las
-- conexiones via IAP tunnel se autentican como la SA `db-bastion-sa`. Postgres
-- crea automaticamente el rol al primer login (porque la SA esta registrada
-- como CLOUD_IAM_SERVICE_ACCOUNT en data.tf), pero sin grants ese rol no
-- puede leer/escribir nada.
--
-- Este script aplica los privilegios minimos para el flujo dev local:
--   - CONNECT a la DB
--   - USAGE en schema public
--   - SELECT/INSERT/UPDATE/DELETE en tablas existentes
--   - USAGE+SELECT en sequences (para inserts con SERIAL)
--   - DEFAULT PRIVILEGES para que tablas/sequences nuevas hereden permisos
--
-- DDL (CREATE/DROP/ALTER) queda DELIBERADAMENTE FUERA. Migrations corren con
-- booster_app (password mode) — el rol SA del bastion es solo para queries
-- de lectura y escritura puntual. Esto limita el blast radius de un error
-- humano via psql/MCP.
--
-- Como aplicar (una sola vez post terraform apply):
--   bash scripts/db/connect.sh AUTH_MODE=password \
--     -f scripts/sql/2026-05-03-grant-bastion-sa.sql
--
-- Idempotente: GRANT no falla si los privilegios ya estan asignados.

\set ON_ERROR_STOP on

-- El nombre del rol IAM SERVICE ACCOUNT en Postgres es el email del SA SIN
-- el sufijo `.gserviceaccount.com` (convencion Cloud SQL). El rol existe
-- porque `google_sql_user.bastion_sa` esta declarado en data.tf.
\set bastion_sa '"db-bastion-sa@booster-ai-494222.iam"'

GRANT CONNECT ON DATABASE booster_ai TO :bastion_sa;
GRANT USAGE ON SCHEMA public TO :bastion_sa;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA public
  TO :bastion_sa;

GRANT USAGE, SELECT
  ON ALL SEQUENCES IN SCHEMA public
  TO :bastion_sa;

-- Default privileges: aplica automaticamente a tablas/sequences nuevas
-- creadas por booster_app (el owner de la DB tras migrations).
ALTER DEFAULT PRIVILEGES FOR ROLE booster_app IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :bastion_sa;

ALTER DEFAULT PRIVILEGES FOR ROLE booster_app IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :bastion_sa;

-- Smoke test al final: si llegamos aca sin error, el rol puede leer.
SELECT current_user AS executing_as,
       current_database() AS db,
       (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public') AS public_tables,
       'GRANTs aplicados a ' || :'bastion_sa' AS status;
