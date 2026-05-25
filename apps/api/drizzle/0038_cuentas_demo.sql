-- Migration 0038 — cuentas_demo: tabla DB-driven para H1.1 SEC-001 Sprint 2a.
--
-- Diseño (per spec sec-001-cierre §3 H1.1 SC-1.1.8 v3.2 reformado):
--   - Sustituye el patrón anterior de "module-level constants" (DEMO_PASSWORD
--     + DEMO_*_EMAIL hardcoded en seed-demo.ts) por una tabla DB que registra
--     las cuentas demo activas + retiradas.
--   - Coexistencia de UIDs viejas (deshabilitado_en NOT NULL) y nuevas
--     (deshabilitado_en NULL) en la misma tabla sin race conditions ni
--     unbounded growth en cold-starts repetidos.
--   - email determinístico por persona: el seed-demo refactorizado
--     (Sprint 2a T3) hace SELECT email FROM cuentas_demo WHERE persona=X AND
--     deshabilitado_en IS NULL antes de cualquier llamada a Firebase Admin
--     SDK. Idempotente by design.
--
-- Naming bilingüe (CLAUDE.md §Reglas naming bilingüe):
--   - Tabla y columnas: español snake_case sin tildes.
--   - Enum name: snake_case Spanish; values en Spanish per CLAUDE.md
--     §Reglas naming + spec.md v3.3 amendment 2026-05-25 (equivalencias:
--     generador_carga ↔ shipper, transportista ↔ carrier, stakeholder y
--     conductor invariantes).
--
-- ADR: docs/adr/053-post-disclosure-account-replacement.md (Proposed
-- 2026-05-25 via PR #334; transitiona a Accepted en T7b al merge del
-- PR #1 Sprint 2a).

-- 1. Enum persona_demo.
CREATE TYPE "persona_demo" AS ENUM (
  'generador_carga',
  'transportista',
  'stakeholder',
  'conductor'
);

-- 2. Tabla cuentas_demo.
--
-- firebase_uid es nullable para soportar el flujo de creación:
--   1. INSERT row con email determinístico, firebase_uid NULL.
--   2. Llamar firebase Admin SDK createUser → recibir uid.
--   3. UPDATE cuentas_demo SET firebase_uid=<uid> WHERE email=<email>.
-- Esta separación permite recuperar de fallos parciales (script crash
-- entre paso 1 y paso 3 deja state inconsistente detectable: row sin uid).
CREATE TABLE "cuentas_demo" (
  "persona" "persona_demo" NOT NULL,
  "email" varchar(320) NOT NULL,
  "firebase_uid" varchar(128),
  "creado_en" timestamptz NOT NULL DEFAULT now(),
  "deshabilitado_en" timestamptz,
  PRIMARY KEY ("email")
);

-- Email es la unique key porque es la identidad estable de la cuenta demo.
-- firebase_uid también debe ser único cuando está poblado, pero permitimos
-- duplicados parciales (multiple rows con uid NULL) para no bloquear inserts
-- concurrentes durante la creación. Constraint solo aplica a valores no-null.
CREATE UNIQUE INDEX "cuentas_demo_firebase_uid_unique"
  ON "cuentas_demo" ("firebase_uid")
  WHERE "firebase_uid" IS NOT NULL;

-- Index para query principal del seed: WHERE persona=X AND deshabilitado_en IS NULL.
CREATE INDEX "cuentas_demo_persona_activas"
  ON "cuentas_demo" ("persona")
  WHERE "deshabilitado_en" IS NULL;

COMMENT ON TABLE "cuentas_demo" IS
  'SEC-001 Sprint 2a H1.1: cuentas demo DB-driven. Reemplaza module-level constants pre-Sprint-2a. Ver docs/adr/053-post-disclosure-account-replacement.md.';

COMMENT ON COLUMN "cuentas_demo"."persona" IS
  'Persona enum Spanish: generador_carga (ex-shipper), transportista (ex-carrier), stakeholder, conductor. Spec v3.3 amendment 2026-05-25.';

COMMENT ON COLUMN "cuentas_demo"."email" IS
  'Email determinístico de la cuenta demo. Pattern: demo-2026-<persona>@boosterchile.com (drivers+demo-2026-conductor@boosterchile.invalid para conductor). PK porque es la identidad estable.';

COMMENT ON COLUMN "cuentas_demo"."firebase_uid" IS
  'UID asignado por Firebase Admin SDK auth.createUser. NULL hasta que el script Sprint 2a T4 harden-demo-accounts.ts --recreate complete la creación. NULL transitorio es estado válido.';

COMMENT ON COLUMN "cuentas_demo"."deshabilitado_en" IS
  'Timestamp cuando la cuenta fue retirada via auth.updateUser({disabled: true}). NULL = activa. NOT NULL = retirada irreversiblemente per ADR-053 post-disclosure account replacement.';
