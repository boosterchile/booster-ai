-- Migration 0048 — tipologías de flota: unidad motriz/arrastre + carrocería +
-- configuración de viaje (hito CORFO mes 8, W4a). Decisiones del PO: D1
-- (.specs/hito-2-corfo-mes-8/decisiones.md, Opción A + 4 condiciones) y D4
-- (DDL aprobado con 5 condiciones, 2026-07-06). Ver docs/adr/073-tipologias-flota-configuracion-glec.md
-- para la taxonomía completa, compatibilidades y derivación de clase GLEC.
--
-- Qué introduce:
--   - `vehiculos.categoria_unidad` — motriz vs arrastre (D1: generaliza
--     "vehículo" para soportar tracto+semirremolque además del camión rígido
--     de siempre).
--   - `vehiculos.tipo_unidad` — subtipo dentro de la categoría (tracto_camion,
--     camion_rigido, camioneta, furgon, semirremolque, remolque). NULLABLE:
--     solo las filas legacy (backfill best-effort abajo) quedan sin valor
--     100% confiable; toda escritura NUEVA lo exige vía Zod (D4.2, capa
--     apps/api/src/routes/vehiculos.ts + packages/shared-schemas).
--   - `vehiculos.carroceria` — carrocería ortogonal a la categoría/tipo
--     (plano, cortina, furgon_cerrado, refrigerado, tolva, cisterna,
--     portacontenedor, cama_baja, jaula, forestal). NULLABLE.
--   - `asignaciones.unidad_arrastre_id` — FK opcional a `vehiculos` para la
--     unidad de arrastre efectivamente enganchada en ese servicio (0..1,
--     deuda 0..N/bitrén declarada en
--     .specs/_followups/flota-bitren-0-n-arrastres.md, D1.1). CORRECCIÓN vs
--     el plan original (que la puso en `viajes`): el vehículo del servicio
--     vive en `asignaciones` (`vehiculo_id`, 1:1 con `viajes` vía
--     `viaje_id` UNIQUE) — la unidad de arrastre es parte de esa misma
--     "configuración efectiva del servicio", no del viaje en abstracto.
--
-- La columna legacy `tipo_vehiculo` (enum `tipo_vehiculo`, 9 valores) **NO se
-- toca**: ni se dropea ni se deprecia funcionalmente. Sigue siendo NOT NULL
-- y sigue siendo la fuente de verdad para matching-algorithm, cargo-request
-- y seed-demo (fuera de scope de W4a, ver ADR-073 §"Alcance").
--
-- Expand-only (ADR-066 / audit P1-H): solo CREATE TYPE, ADD COLUMN (nullable
-- o con DEFAULT), UPDATE de backfill (no reescribe filas de otras tablas),
-- ADD CONSTRAINT (CHECK/FK, no "SET NOT NULL" sobre columna preexistente) y
-- CREATE INDEX. Sin DROP, sin RENAME. El rollback de la revisión Cloud Run
-- es seguro: una revisión previa del código ignora las columnas/constraints
-- nuevas. Ver docs/runbooks/db-migration-rollback.md.
--
-- Plan de contract (D4.2, escrito acá per condición del PO): cuando el
-- backfill legacy quede revisado en la UI de flota (W4b, ver caveat D4.1
-- abajo) y las escrituras nuevas lleven ≥1 sprint exigiendo `tipo_unidad`
-- (ya lo exige Zod desde este mismo PR), una migración `contract` futura
-- puede endurecer la columna a NOT NULL con el marcador
-- `-- contract-phase: ADR-073` que exige el guard `check-migration-safety`
-- (ADR-066). No se hace en esta migración: expand-only.

-- =============================================================================
-- 1. Enums nuevos.
-- =============================================================================

CREATE TYPE "categoria_unidad" AS ENUM ('motriz', 'arrastre');
--> statement-breakpoint

CREATE TYPE "tipo_unidad" AS ENUM (
  'tracto_camion',
  'camion_rigido',
  'camioneta',
  'furgon',
  'semirremolque',
  'remolque'
);
--> statement-breakpoint

CREATE TYPE "tipo_carroceria" AS ENUM (
  'plano',
  'cortina',
  'furgon_cerrado',
  'refrigerado',
  'tolva',
  'cisterna',
  'portacontenedor',
  'cama_baja',
  'jaula',
  'forestal'
);
--> statement-breakpoint

-- =============================================================================
-- 2. Columnas nuevas en `vehiculos`.
-- =============================================================================

-- DEFAULT constante 'motriz' materializa en catálogo (Postgres 11+, sin
-- reescritura bloqueante de filas existentes): todo vehículo legacy queda
-- categorizado motriz por default, correcto para los 8 de 9 tipos legacy
-- (solo `semi_remolque` es arrastre — corregido por el backfill abajo).
ALTER TABLE vehiculos
  ADD COLUMN categoria_unidad categoria_unidad NOT NULL DEFAULT 'motriz';
--> statement-breakpoint

-- Nullable: NULL solo para filas legacy que el backfill no pudo mapear con
-- confianza total (ver caveat D4.1 abajo). Zod exige el campo en toda
-- escritura NUEVA (D4.2) — el NOT NULL retroactivo es la fase contract
-- futura, no esta migración.
ALTER TABLE vehiculos
  ADD COLUMN tipo_unidad tipo_unidad;
--> statement-breakpoint

ALTER TABLE vehiculos
  ADD COLUMN carroceria tipo_carroceria;
--> statement-breakpoint

-- =============================================================================
-- 3. Backfill de filas existentes (mapping D4, presentado junto al DDL).
--
-- CAVEAT D4.1 (condición 1 del PO, 2026-07-06): el enum legacy `tipo_vehiculo`
-- NO tenía un valor "tracto" — los tractos reales del piloto están casi
-- seguro registrados hoy como `camion_pesado`. Este backfill los mapea a
-- `camion_rigido` (heurística: "el más pesado de los rígidos") por
-- consistencia con el resto del mapping, PERO es sabido que es incorrecto
-- para cualquier tracto real del piloto. Ídem para `refrigerado`/`tanque`,
-- que este backfill asume montados sobre chasís rígido (`camion_rigido`)
-- cuando en la práctica pueden ser semirremolques refrigerados/cisterna.
-- Acción requerida: revisar las filas reales del piloto en la UI de flota
-- (W4b) y corregir manualmente `tipo_unidad`/`categoria_unidad` donde
-- corresponda. Este backfill es un punto de partida auditable, no un hecho
-- verificado.
-- =============================================================================

UPDATE vehiculos SET tipo_unidad = 'camioneta'
  WHERE tipo_vehiculo = 'camioneta';
--> statement-breakpoint

UPDATE vehiculos SET tipo_unidad = 'furgon', carroceria = 'furgon_cerrado'
  WHERE tipo_vehiculo IN ('furgon_pequeno', 'furgon_mediano');
--> statement-breakpoint

-- D4.1: incluye camion_pesado — ver caveat arriba (tractos reales del
-- piloto probablemente viven acá, mal clasificados como rígidos).
UPDATE vehiculos SET tipo_unidad = 'camion_rigido'
  WHERE tipo_vehiculo IN ('camion_pequeno', 'camion_mediano', 'camion_pesado');
--> statement-breakpoint

-- NOTA (M3, fix review W4a, ADR-073 §5): este backfill NO nulifica
-- `combustible`/`consumo_l_100km_base` de las filas `semi_remolque`
-- legacy. Bajo la semántica nueva (D4.5), `arrastre` exige esos dos
-- campos SIEMPRE null (un arrastre no tiene motor propio) — si alguna
-- fila legacy los tenía poblados (dato heredado del modelo plano
-- anterior, donde `semi_remolque` no distinguía motriz/arrastre), queda
-- en estado latente contra D4.5 hasta que se limpie. No se corrige acá
-- (expand-only, no se reescriben columnas fuera del mapping D4): el
-- primer PATCH que toque la config de unidad de una de estas filas
-- (`apps/api/src/routes/vehiculos.ts` vía `validarCoherenciaUnidadVehiculo`)
-- exigirá `consumption_l_per_100km_baseline`/`fuel_type` = null y
-- devolverá 422 (`arrastre_consumo_debe_ser_null`/`arrastre_combustible_debe_ser_null`)
-- si no vienen limpios en el mismo PATCH. Revisión de estas filas es
-- parte de W4b (junto con el caveat D4.1 de arriba).
UPDATE vehiculos SET categoria_unidad = 'arrastre', tipo_unidad = 'semirremolque'
  WHERE tipo_vehiculo = 'semi_remolque';
--> statement-breakpoint

-- D4.1: asume chasís rígido — ver caveat arriba (puede ser semirremolque
-- refrigerado en la realidad del piloto).
UPDATE vehiculos SET tipo_unidad = 'camion_rigido', carroceria = 'refrigerado'
  WHERE tipo_vehiculo = 'refrigerado';
--> statement-breakpoint

-- D4.1: asume chasís rígido — ver caveat arriba (puede ser semirremolque
-- cisterna en la realidad del piloto).
UPDATE vehiculos SET tipo_unidad = 'camion_rigido', carroceria = 'cisterna'
  WHERE tipo_vehiculo = 'tanque';
--> statement-breakpoint

-- =============================================================================
-- 4. CHECK tipo↔categoría (D4 condición 3 + D1 condición 3): espejo runtime
--    en packages/shared-schemas/src/domain/vehicle.ts
--    (validarCoherenciaUnidadVehiculo) y en el Zod local de
--    apps/api/src/routes/vehiculos.ts (422 antes de llegar a esta CHECK).
--    Tolerante a NULL: una fila legacy sin tipo_unidad no viola el CHECK
--    (no podemos validar coherencia sobre un dato que no tenemos).
-- =============================================================================

ALTER TABLE vehiculos
  ADD CONSTRAINT chk_vehiculos_tipo_categoria CHECK (
    tipo_unidad IS NULL
    OR ((categoria_unidad = 'arrastre') = (tipo_unidad IN ('semirremolque', 'remolque')))
  );
--> statement-breakpoint

-- =============================================================================
-- 5. `asignaciones.unidad_arrastre_id` — FK a la unidad de arrastre de la
--    configuración efectiva del servicio (D4: corrección de atribución —
--    el plan original la había puesto en `viajes`, pero el vehículo del
--    servicio vive en `asignaciones`, no en `viajes`).
-- =============================================================================

ALTER TABLE asignaciones
  ADD COLUMN unidad_arrastre_id uuid REFERENCES vehiculos(id) ON DELETE RESTRICT;
--> statement-breakpoint

-- D4 condición 3 (D1 condición 3, "un arrastre nunca puede ser
-- asignado_a_vehiculo_id"): CHECK same-row acá cubre el caso simétrico
-- dentro de la MISMA asignación (la unidad de arrastre no puede ser
-- literalmente el mismo vehículo que la unidad motriz). La coherencia de
-- categoría (vehiculo_id debe ser motriz, unidad_arrastre_id debe ser
-- arrastre) y la compatibilidad tracto↔semirremolque/rígido↔remolque se
-- validan en runtime al armar la configuración (W4c, D1.3) — no hay write
-- path de asignación en W4a.
ALTER TABLE asignaciones
  ADD CONSTRAINT chk_asignaciones_arrastre_distinto CHECK (
    unidad_arrastre_id IS NULL OR unidad_arrastre_id <> vehiculo_id
  );
--> statement-breakpoint

-- Índice parcial: solo asignaciones con arrastre efectivamente enganchado.
-- La mayoría de las asignaciones (piloto mes 8, sin bitrén) tendrán
-- unidad_arrastre_id NULL — indexar solo el subconjunto relevante evita
-- inflar el índice con NULLs.
CREATE INDEX idx_asignaciones_unidad_arrastre
  ON asignaciones (unidad_arrastre_id)
  WHERE unidad_arrastre_id IS NOT NULL;
--> statement-breakpoint

COMMENT ON COLUMN vehiculos.tipo_unidad IS
  'Subtipo dentro de categoria_unidad (D1/D4, ADR-073). NULL solo en filas legacy backfilled best-effort (ver comentario de migración 0048, caveat D4.1: camion_pesado/refrigerado/tanque pueden estar mal clasificados — revisar en W4b UI). Toda escritura nueva lo exige (D4.2).';
--> statement-breakpoint

COMMENT ON COLUMN asignaciones.unidad_arrastre_id IS
  'Unidad de arrastre (semirremolque/remolque) enganchada en esta asignación, 0..1 (deuda 0..N/bitrén declarada en .specs/_followups/flota-bitren-0-n-arrastres.md). NULL = configuración motriz sola. FK ON DELETE RESTRICT: no se puede borrar un vehículo mientras esté enganchado como arrastre de una asignación viva.';
