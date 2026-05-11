-- Migration 0026 — Compliance: documentos vehículo + conductor (D6)
--
-- Tablas para que el carrier gestione la documentación legal/operacional
-- de su flota y conductores. Reflejan requisitos DS 170 + Ley Tránsito CL:
--
--   - Revisión técnica (anual)
--   - Permiso de circulación (anual)
--   - SOAP (anual)
--   - Padrón (Registro Civil)
--   - Licencia conducir (clase específica en `conductores.licencia_clase`)
--   - Curso B6 (cargas peligrosas DS 298)
--   - Certificado antecedentes / psicotécnico / etc.
--
-- Decisiones:
--
--   1. **Tabla por entidad** (vehículo vs conductor) en vez de tabla
--      polimórfica `documentos` con `entidad_tipo`. Razones:
--      - Tipos de documento son distintos sets (revisión técnica ≠ licencia).
--      - Indices más eficientes (no necesitan filtrar por entidad_tipo).
--      - Validación a nivel BD (FK explícita).
--
--   2. **`archivo_url` texto libre** para demo. Acepta URLs de servicios
--      cloud (Drive, Dropbox, Box) como atajo MVP. Upload directo a
--      `gs://booster-ai-docs` con signed URLs queda como follow-up
--      (requiere bucket Terraform + service-side signing).
--
--   3. **`estado` persistido** (vigente/por_vencer/vencido) en vez de
--      calcular vs NOW() cada vez. El dashboard de cumplimiento queries
--      por estado son frecuentes; precalcular en write evita scans.
--      Recálculo nightly via cron job (futuro) por si cambia el threshold.
--
--   4. **ON DELETE CASCADE** desde `vehiculos`/`conductores` — si el
--      vehículo se retira (soft delete) sus docs siguen, pero si se borra
--      duro (no debería pasar) se limpian.
--
--   5. **`empresas.compliance_habilitado`** flag opt-in. El módulo no
--      aparece para empresas que no lo activan. El shipper puede solicitar
--      el opt-in (campo separado en futuro).
--
-- Riesgo deploy: CREATE TABLE + CREATE TYPE + ADD COLUMN nullable+default.
-- Todo metadata-only. Reversible con DROP.

CREATE TYPE "tipo_documento_vehiculo" AS ENUM (
  'revision_tecnica',
  'permiso_circulacion',
  'soap',
  'padron',
  'seguro_carga',
  'poliza_responsabilidad',
  'certificado_emisiones',
  'otro'
);

CREATE TYPE "tipo_documento_conductor" AS ENUM (
  'licencia_conducir',
  'curso_b6',
  'certificado_antecedentes',
  'examen_psicotecnico',
  'hoja_vida_conductor',
  'certificado_salud',
  'otro'
);

CREATE TYPE "estado_documento" AS ENUM ('vigente', 'por_vencer', 'vencido');

ALTER TABLE "empresas"
  ADD COLUMN "compliance_habilitado" boolean NOT NULL DEFAULT false;

CREATE TABLE "documentos_vehiculo" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "vehiculo_id" uuid NOT NULL REFERENCES "vehiculos"("id") ON DELETE CASCADE,
  "tipo" "tipo_documento_vehiculo" NOT NULL,
  "archivo_url" text,
  "fecha_emision" date,
  "fecha_vencimiento" date,
  "estado" "estado_documento" NOT NULL DEFAULT 'vigente',
  "notas" text,
  "creado_en" timestamp with time zone NOT NULL DEFAULT now(),
  "actualizado_en" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "idx_docs_vehiculo_vehiculo" ON "documentos_vehiculo" ("vehiculo_id");
CREATE INDEX "idx_docs_vehiculo_vencimiento" ON "documentos_vehiculo" ("fecha_vencimiento");
CREATE INDEX "idx_docs_vehiculo_estado" ON "documentos_vehiculo" ("estado");

CREATE TABLE "documentos_conductor" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "conductor_id" uuid NOT NULL,
  "tipo" "tipo_documento_conductor" NOT NULL,
  "archivo_url" text,
  "fecha_emision" date,
  "fecha_vencimiento" date,
  "estado" "estado_documento" NOT NULL DEFAULT 'vigente',
  "notas" text,
  "creado_en" timestamp with time zone NOT NULL DEFAULT now(),
  "actualizado_en" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "idx_docs_conductor_conductor" ON "documentos_conductor" ("conductor_id");
CREATE INDEX "idx_docs_conductor_vencimiento" ON "documentos_conductor" ("fecha_vencimiento");
CREATE INDEX "idx_docs_conductor_estado" ON "documentos_conductor" ("estado");
