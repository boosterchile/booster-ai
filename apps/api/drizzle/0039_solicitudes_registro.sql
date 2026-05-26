-- Migration 0039 — solicitudes_registro: signup público gated por admin-approval
-- (SEC-001 Sprint 2b H1.2, plan-sprint-2b T7).
--
-- Diseño (per spec sec-001-cierre §3 H1.2 SC-1.2.1 + ADR-052):
--   - Sustituye el flow anterior `createUserWithEmailAndPassword` client-side
--     (apps/web/src/hooks/use-auth.ts:137) por POST /api/v1/signup-request
--     que inserta row con estado=pendiente_aprobacion.
--   - Admin approve (T10) ejecuta Firebase Admin SDK auth.createUser +
--     UPDATE estado=aprobado + aprobado_por + aprobado_en. Reject solo
--     actualiza estado=rechazado.
--   - Email enumeration defense (SC-1.2.5): el endpoint NO revela si email
--     ya existe; el dedup lo decide service layer T8.
--
-- Naming bilingüe (CLAUDE.md §Reglas naming bilingüe):
--   - Tabla y columnas: español snake_case sin tildes.
--   - Enum name: snake_case Spanish; values en Spanish per CLAUDE.md.
--
-- ADR: docs/adr/052-signup-migration-admin-sdk-gate.md (Proposed 2026-05-26
-- via PR #351; transiciona a Accepted en T13 post-canary success + 2h watch).

-- 1. Enum estado_solicitud_registro.
--
-- Transiciones permitidas (service layer T10 enforced; no CHECK constraint
-- DB-side porque la transición depende de columnas adicionales):
--   pendiente_aprobacion → aprobado   (admin approve)
--   pendiente_aprobacion → rechazado  (admin reject)
CREATE TYPE "public"."estado_solicitud_registro" AS ENUM (
  'pendiente_aprobacion',
  'aprobado',
  'rechazado'
);
--> statement-breakpoint
-- 2. Tabla solicitudes_registro.
--
-- id es uuid (no email PK como cuentas_demo) porque:
--   - El mismo email puede aparecer en múltiples rows (resubmit tras reject).
--   - Admin UI necesita un identifier estable en URLs /admin/signup-requests/:id.
--   - pgcrypto gen_random_uuid es la convención del repo para tablas mutables.
--
-- aprobado_por es text (no varchar) porque es columna de audit no consultada
-- frecuentemente; sin restricción de longitud (Firebase admin emails pueden
-- variar). aprobado_en es nullable y se setea cuando estado deja de ser
-- pendiente_aprobacion (service layer mantiene la invariante).
CREATE TABLE "solicitudes_registro" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" varchar(320) NOT NULL,
  "nombre_completo" varchar(200) NOT NULL,
  "estado" "estado_solicitud_registro" DEFAULT 'pendiente_aprobacion' NOT NULL,
  "solicitado_en" timestamptz DEFAULT now() NOT NULL,
  "aprobado_por" text,
  "aprobado_en" timestamptz
);
--> statement-breakpoint
COMMENT ON TABLE "solicitudes_registro" IS
  'SEC-001 Sprint 2b H1.2: signup público gated por admin-approval. POST /api/v1/signup-request inserta row pendiente; admin approve (T10) ejecuta Admin SDK createUser. Ver docs/adr/052-signup-migration-admin-sdk-gate.md.';
--> statement-breakpoint
COMMENT ON COLUMN "solicitudes_registro"."email" IS
  'Email del solicitante. Max 320 chars (RFC 5321). Service layer T8 lowercase y dedupea sin exponer enumeration vector.';
--> statement-breakpoint
COMMENT ON COLUMN "solicitudes_registro"."estado" IS
  'Workflow state. Inicial pendiente_aprobacion; admin approve→aprobado o reject→rechazado. Estados terminales (no más transiciones).';
--> statement-breakpoint
COMMENT ON COLUMN "solicitudes_registro"."aprobado_por" IS
  'Email del admin que tomó la decisión. NULL mientras pending. Audit trail (Ley 19.628 art. 5).';
