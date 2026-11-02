-- Migration 0067: certificados versionados (HC-001 parte 3a, decision.md 14:10).
--
-- Expand-only: tabla nueva y una columna nullable en metricas_viaje. Las 4
-- columnas certificado_* de metricas_viaje NO se tocan: siguen espejando la
-- versión vigente, así los lectores actuales no cambian.
--
-- Backfill: solo la v1 de BOO-HC7DJX, identificada por codigo_seguimiento y
-- copiada de metricas_viaje, si existe en este entorno y ya fue emitida. En un
-- entorno sin ese viaje no inserta nada. Todo es idempotente (IF NOT EXISTS y
-- ON CONFLICT DO NOTHING).

CREATE TABLE IF NOT EXISTS certificados_viaje (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  viaje_id uuid NOT NULL REFERENCES viajes(id) ON DELETE RESTRICT,
  version integer NOT NULL,
  estado varchar(20) NOT NULL DEFAULT 'vigente',
  sha256 char(64) NOT NULL,
  pdf_url text,
  kms_version varchar(50),
  emitido_en timestamp with time zone NOT NULL,
  reemplazado_en timestamp with time zone,
  reemplazado_por uuid REFERENCES certificados_viaje(id) ON DELETE RESTRICT,
  fuente_distancia varchar(20),
  motivo_fallback varchar(40),
  decision_version smallint,
  creado_en timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT uq_certificados_viaje_version UNIQUE (viaje_id, version),
  CONSTRAINT chk_certificados_viaje_version CHECK (version >= 1),
  CONSTRAINT chk_certificados_viaje_estado CHECK (estado IN ('vigente', 'reemplazado', 'revertido'))
);

-- A lo más una versión vigente por viaje.
CREATE UNIQUE INDEX IF NOT EXISTS uq_certificados_viaje_vigente
  ON certificados_viaje (viaje_id) WHERE estado = 'vigente';
-- /verify busca por sha256 dentro del viaje.
CREATE INDEX IF NOT EXISTS idx_certificados_viaje_sha256 ON certificados_viaje (sha256);

ALTER TABLE metricas_viaje ADD COLUMN IF NOT EXISTS certificado_vigente_id uuid
  REFERENCES certificados_viaje(id) ON DELETE RESTRICT;

WITH v1 AS (
  INSERT INTO certificados_viaje (
    viaje_id, version, estado, sha256, pdf_url, kms_version, emitido_en,
    fuente_distancia, motivo_fallback, decision_version
  )
  SELECT m.viaje_id, 1, 'vigente', m.certificado_sha256, m.certificado_pdf_url,
         m.certificado_kms_version, m.certificado_emitido_en,
         m.fuente_distancia, m.motivo_fallback, m.decision_version
    FROM metricas_viaje m
    JOIN viajes v ON v.id = m.viaje_id
   WHERE v.codigo_seguimiento = 'BOO-HC7DJX'
     AND m.certificado_sha256 IS NOT NULL
     AND m.certificado_emitido_en IS NOT NULL
  ON CONFLICT (viaje_id, version) DO NOTHING
  RETURNING id, viaje_id
)
UPDATE metricas_viaje m
   SET certificado_vigente_id = v1.id
  FROM v1
 WHERE m.viaje_id = v1.viaje_id;
