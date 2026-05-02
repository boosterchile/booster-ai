-- =============================================================================
-- Grants para operadores IAM database auth — Capa 1 del ADR-013.
-- =============================================================================
-- Cloud SQL crea el role Postgres automáticamente cuando se registra un
-- google_sql_user.iam_operators (`dev@boosterchile.com`), pero solo le da
-- pertenencia al rol `cloudsqliamuser` que provee CONNECT. Para hacer
-- queries reales, el operador necesita SELECT/INSERT/UPDATE/DELETE en las
-- tablas del schema public.
--
-- Este script se ejecuta como `booster_app` (owner de las tablas creadas
-- por las migrations Drizzle) — solo el owner puede GRANTear privilegios
-- sobre objetos que posee.
--
-- Cómo correr:
--   1. Levantar IAP tunnel hacia el bastion (ver scripts/db/connect.sh)
--   2. Connectar como booster_app con su password de Secret Manager
--      (DATABASE_URL secret, parsing de la cadena)
--   3. \i scripts/sql/2026-05-02-iam-operator-grants.sql
--   4. Validar: connectar como dev@boosterchile.com via IAP tunnel y correr
--      `SELECT count(*) FROM usuarios;`
--
-- Nuevos operadores: agregar al `local.db_iam_operators` en data.tf,
-- terraform apply, y volver a correr este script.
-- =============================================================================

-- USAGE en el schema (requerido para que el rol pueda RESOLVER nombres
-- de tablas).
GRANT USAGE ON SCHEMA public TO "dev@boosterchile.com";

-- Permisos completos de DML sobre tablas existentes.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "dev@boosterchile.com";

-- Sequences (necesarios para INSERTs que usen DEFAULT con nextval).
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "dev@boosterchile.com";

-- Default privileges: tablas/sequences creadas por booster_app en el FUTURO
-- (próximas migrations) heredan los mismos grants automáticamente.
ALTER DEFAULT PRIVILEGES FOR ROLE booster_app IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "dev@boosterchile.com";

ALTER DEFAULT PRIVILEGES FOR ROLE booster_app IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO "dev@boosterchile.com";

-- DDL deliberadamente NO incluido (CREATE/DROP/ALTER). Para ejecutar
-- migrations o cambios de schema, conectarse como booster_app con password.
-- Mantener esa separación reduce el blast radius de un comando accidental
-- como operador.
