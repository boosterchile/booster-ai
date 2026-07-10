-- Migration 0049 — eventos_impersonacion: auditoría de impersonación
-- (impersonación auditada, backend). Cada inicio de sesión impersonada
-- (POST /auth/impersonate) inserta una fila quién→a-quién→cuándo:
--   - admin_id: platform-admin que impersona (FK usuarios, RESTRICT).
--   - usuario_impersonado_id: usuario target (FK usuarios, RESTRICT).
--   - empresa_id: empresa activa intencionada (FK empresas, RESTRICT), NULLABLE
--     — el cliente elige la empresa activa vía X-Empresa-Id y puede variar.
--   - iniciado_en / finalizado_en (nullable, lo setea el "salir").
-- Las mutaciones individuales durante la sesión se atribuyen vía el log
-- estructurado del middleware impersonation-write-guard (impersonated_by).
--
-- Expand-only (ADR-066): solo CREATE TABLE + FKs + CREATE INDEX. Sin DROP, sin
-- RENAME, sin SET NOT NULL sobre columnas preexistentes. Tabla nueva → el
-- rollback de la revisión Cloud Run es seguro (una revisión previa la ignora).
-- FKs ON DELETE RESTRICT: un registro de auditoría nunca debe desaparecer por
-- el borrado de un usuario/empresa. Reverse manual en
-- drizzle/down/0049_eventos_impersonacion.down.sql (MANUAL-APPLY-ONLY).

CREATE TABLE "eventos_impersonacion" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "admin_id" uuid NOT NULL,
  "usuario_impersonado_id" uuid NOT NULL,
  "empresa_id" uuid,
  "iniciado_en" timestamp with time zone DEFAULT now() NOT NULL,
  "finalizado_en" timestamp with time zone
);
--> statement-breakpoint

ALTER TABLE "eventos_impersonacion"
  ADD CONSTRAINT "eventos_impersonacion_admin_id_usuarios_id_fk"
  FOREIGN KEY ("admin_id") REFERENCES "public"."usuarios"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "eventos_impersonacion"
  ADD CONSTRAINT "eventos_impersonacion_usuario_impersonado_id_usuarios_id_fk"
  FOREIGN KEY ("usuario_impersonado_id") REFERENCES "public"."usuarios"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "eventos_impersonacion"
  ADD CONSTRAINT "eventos_impersonacion_empresa_id_empresas_id_fk"
  FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX "idx_eventos_impersonacion_admin"
  ON "eventos_impersonacion" USING btree ("admin_id");
--> statement-breakpoint

CREATE INDEX "idx_eventos_impersonacion_target"
  ON "eventos_impersonacion" USING btree ("usuario_impersonado_id");
--> statement-breakpoint

CREATE INDEX "idx_eventos_impersonacion_iniciado"
  ON "eventos_impersonacion" USING btree ("iniciado_en");
