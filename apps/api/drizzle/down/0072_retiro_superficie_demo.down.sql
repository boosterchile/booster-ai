-- MANUAL-APPLY-ONLY. El auto-migrator no lee este directorio (ADR-066).
-- Restituye la ESTRUCTURA de 0024 (es_demo) y 0038 (cuentas_demo). No
-- recupera filas: los datos de cuentas_demo solo vuelven con PITR clone
-- (docs/runbooks/db-migration-rollback.md). Ninguna revisión posterior al
-- PR 1 (#745) lee estas estructuras, así que este reverse solo hace falta
-- para volver a una revisión anterior a ese PR.

ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "es_demo" boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'persona_demo') THEN
    CREATE TYPE "persona_demo" AS ENUM ('generador_carga', 'transportista', 'stakeholder', 'conductor');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "cuentas_demo" (
  "persona" "persona_demo" NOT NULL,
  "email" varchar(320) NOT NULL,
  "firebase_uid" varchar(128),
  "creado_en" timestamptz NOT NULL DEFAULT now(),
  "deshabilitado_en" timestamptz,
  PRIMARY KEY ("email")
);
CREATE UNIQUE INDEX IF NOT EXISTS "cuentas_demo_firebase_uid_unique"
  ON "cuentas_demo" ("firebase_uid")
  WHERE "firebase_uid" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "cuentas_demo_persona_activas"
  ON "cuentas_demo" ("persona")
  WHERE "deshabilitado_en" IS NULL;
