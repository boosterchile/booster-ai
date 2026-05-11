-- Migration 0021 — Tabla `conductores` (D7)
--
-- Crea la entidad "perfil profesional de conductor" separada de `usuarios`
-- (que es la identidad Firebase / auth). El user es la cuenta; el conductor
-- es el perfil profesional con licencia, vencimiento y status operativo.
--
-- Decisiones del modelo (ver memoria project_identity_model_decisions.md):
--
--   1. Tabla separada vs columnas en `usuarios`:
--      Separamos porque los datos de licencia/vencimientos son del rol
--      profesional, no de la identidad genérica. Un user puede tener
--      múltiples memberships en empresas con distinto rol; pero el perfil
--      conductor pertenece a una sola empresa transportista a la vez. Si
--      cambia de carrier, se da de baja (soft delete) y se crea otro.
--
--   2. UNIQUE (usuario_id):
--      Un user es conductor en una sola empresa simultáneamente. Para
--      transferencias entre carriers se hace soft-delete + insert.
--
--   3. NO FK a `vehiculos`:
--      Sin relación 1:1. La asignación conductor↔vehículo vive en la tabla
--      `asignaciones` (un viaje específico). Un conductor puede operar
--      varios vehículos según turno; un vehículo puede ser operado por
--      varios conductores.
--
--   4. `es_extranjero` boolean:
--      Algunos puertos chilenos (San Antonio, Valparaíso) y plantas
--      industriales bloquean ingreso de conductores no-residentes. La
--      validación ocurre al CREAR la asignación, no acá. Este flag es
--      input para esa validación.
--
--   5. `licencia_vencimiento` DATE (no TIMESTAMP):
--      Resolución diaria es suficiente para "licencia válida hasta el día
--      X". Simplifica chequeos contra NOW()::date.
--
--   6. Soft delete vía `eliminado_en`:
--      Los conductores quedan referenciados por asignaciones históricas.
--      El hard-delete rompe trazabilidad y auditoría.
--
-- Riesgo deploy: bajo. Tabla nueva sin FK desde otras tablas. Reversible
-- vía DROP TABLE + DROP TYPE.

-- Enums
CREATE TYPE "licencia_clase" AS ENUM (
  'A1', 'A2', 'A3', 'A4', 'A5',
  'B', 'C', 'D', 'E', 'F'
);

CREATE TYPE "estado_conductor" AS ENUM (
  'activo',
  'suspendido',
  'en_viaje',
  'fuera_servicio'
);

-- Tabla
CREATE TABLE "conductores" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "usuario_id" uuid NOT NULL UNIQUE REFERENCES "usuarios"("id") ON DELETE RESTRICT,
  "empresa_id" uuid NOT NULL REFERENCES "empresas"("id") ON DELETE RESTRICT,
  "licencia_clase" "licencia_clase" NOT NULL,
  "licencia_numero" varchar(50) NOT NULL,
  "licencia_vencimiento" date NOT NULL,
  "es_extranjero" boolean NOT NULL DEFAULT false,
  "estado_conductor" "estado_conductor" NOT NULL DEFAULT 'activo',
  "creado_en" timestamp with time zone NOT NULL DEFAULT now(),
  "actualizado_en" timestamp with time zone NOT NULL DEFAULT now(),
  "eliminado_en" timestamp with time zone
);

-- Indices
CREATE INDEX "idx_conductores_empresa" ON "conductores" ("empresa_id");
CREATE INDEX "idx_conductores_estado" ON "conductores" ("estado_conductor");
CREATE INDEX "idx_conductores_licencia_vencimiento" ON "conductores" ("licencia_vencimiento");

-- Index parcial para queries "conductores activos no eliminados de la empresa X"
-- — query path más frecuente en /app/conductores y al asignar viaje.
CREATE INDEX "idx_conductores_no_eliminados"
  ON "conductores" ("empresa_id", "estado_conductor")
  WHERE "eliminado_en" IS NULL;
