-- Migration 0089 — empresas.recibe_ofertas_carga: servicio de ofertas de carga
-- por empresa transportista.
-- Spec: .specs/servicios-por-empresa/spec.md
--
-- Una empresa transportista puede operar solo con Booster Fleet, sin el
-- matching. El platform-admin apaga esta bandera por empresa; queda quién y
-- cuándo.
--
-- Expand-only (ADR-066): ADD COLUMN con DEFAULT, sin reescritura de filas
-- (Postgres 11+). El valor por defecto es true: ninguna empresa existente
-- cambia de comportamiento. Una revisión previa del api ignora las columnas.
-- Reverse manual en drizzle/down/0089_empresas_recibe_ofertas_carga.down.sql.

ALTER TABLE empresas
  ADD COLUMN IF NOT EXISTS recibe_ofertas_carga boolean NOT NULL DEFAULT true;
--> statement-breakpoint

ALTER TABLE empresas
  ADD COLUMN IF NOT EXISTS recibe_ofertas_carga_cambiado_en timestamptz;
--> statement-breakpoint

ALTER TABLE empresas
  ADD COLUMN IF NOT EXISTS recibe_ofertas_carga_cambiado_por text;
--> statement-breakpoint

COMMENT ON COLUMN empresas.recibe_ofertas_carga IS
  'Servicio de ofertas de carga: false = la empresa transportista no participa del matching ni ve ofertas ni finanzas (solo Booster Fleet y viajes propios). Lo cambia el platform-admin.';
