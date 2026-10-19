-- Migration 0063 — Auditoría del email de contacto del conductor.
--
-- Expand-only: tabla nueva, sin tocar filas existentes. Cada corrección del
-- email real (y cada reenvío de invitación) deja actor, correo anterior,
-- correo nuevo y la acción sobre Firebase. El PIN no se persiste.

CREATE TABLE "auditoria_email_conductor" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "conductor_id" uuid NOT NULL REFERENCES "conductores"("id") ON DELETE RESTRICT,
  "usuario_id" uuid NOT NULL REFERENCES "usuarios"("id") ON DELETE RESTRICT,
  "empresa_id" uuid NOT NULL REFERENCES "empresas"("id") ON DELETE RESTRICT,
  "actor_usuario_id" uuid NOT NULL REFERENCES "usuarios"("id") ON DELETE RESTRICT,
  "email_anterior" varchar(255) NOT NULL,
  "email_nuevo" varchar(255) NOT NULL,
  "invitacion_reenviada" boolean NOT NULL,
  "accion_firebase" varchar(64) NOT NULL,
  "creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_auditoria_email_conductor_conductor" ON "auditoria_email_conductor" ("conductor_id", "creado_en");
--> statement-breakpoint
CREATE INDEX "idx_auditoria_email_conductor_empresa" ON "auditoria_email_conductor" ("empresa_id", "creado_en");
