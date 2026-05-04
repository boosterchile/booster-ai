-- Migration 0008 — Document index (Sprint 1 — ADR-007)
--
-- Tabla `documentos`: indice metadata-only de archivos en GCS.
-- El contenido del archivo NO vive aca; aqui solo el path relativo al
-- bucket (`gcs_path`). Bucket es config-driven (DOCUMENTS_BUCKET) y
-- unico por ambiente.
--
-- `retencion_hasta` es NULL para tipos sin obligacion legal (ej. fotos
-- operacionales). Para los `dte_*`, `carta_porte` y `acta_entrega` el
-- indexer setea `emitido_en + 6 anios`. El bucket aplica Object Retention
-- Lock con esa misma ventana (configurado fuera de esta migration, en
-- terraform/infrastructure).
--
-- UNIQUE(rut_emisor, folio_sii): natural key de un DTE en el sistema SII.
-- Postgres considera NULLs distintos por default, asi que docs no-DTE
-- (folio NULL) conviven sin colision.

CREATE TYPE "tipo_documento" AS ENUM (
  'dte_guia_despacho',
  'dte_factura',
  'dte_factura_exenta',
  'carta_porte',
  'acta_entrega',
  'certificado_esg',
  'foto_pickup',
  'foto_delivery',
  'firma_receptor',
  'checklist_vehiculo',
  'factura_externa',
  'comprobante_pago',
  'otro'
);

CREATE TABLE "documentos" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "empresa_id" uuid NOT NULL REFERENCES "empresas"("id") ON DELETE RESTRICT,
  "viaje_id" uuid REFERENCES "viajes"("id") ON DELETE SET NULL,
  "tipo" "tipo_documento" NOT NULL,
  "gcs_path" text NOT NULL,
  "sha256" char(64) NOT NULL,
  "mime_type" varchar(127) NOT NULL,
  "tamano_bytes" integer NOT NULL,
  "folio_sii" varchar(40),
  "rut_emisor" varchar(12),
  "emitido_por_usuario_id" uuid REFERENCES "usuarios"("id") ON DELETE SET NULL,
  "emitido_en" timestamptz NOT NULL DEFAULT now(),
  "retencion_hasta" timestamptz,
  "copia_pii_redactada" boolean NOT NULL DEFAULT false,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "creado_en" timestamptz NOT NULL DEFAULT now(),
  "actualizado_en" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "uq_documentos_rut_folio" UNIQUE ("rut_emisor", "folio_sii"),
  CONSTRAINT "chk_documentos_sha256_hex" CHECK ("sha256" ~ '^[0-9a-f]{64}$')
);

CREATE INDEX "idx_documentos_empresa" ON "documentos"("empresa_id");
CREATE INDEX "idx_documentos_viaje" ON "documentos"("viaje_id");
CREATE INDEX "idx_documentos_tipo" ON "documentos"("tipo");
CREATE INDEX "idx_documentos_emitido_en" ON "documentos"("emitido_en");
CREATE INDEX "idx_documentos_retencion" ON "documentos"("retencion_hasta");
