-- Migration 0046 — opt-in de medición de huella de carbono (plan medicion-huella-segmento, Task 1)
--
-- Modela el opt-in de medición de huella estilo Uber: la empresa (cliente)
-- activa la medición para sus viajes, y un viaje puede overridear ese default.
-- El opt-in EFECTIVO es el OR de las empresas participantes (generador +
-- transportista) con override por viaje — el resolver vive en Task 3; esta
-- migración solo crea las columnas.
--
-- Naming inglés total (decisión PO): columnas nuevas en snake_case inglés,
-- divergiendo a propósito de las legadas en español (es_generador_carga). Las
-- legadas NO se migran.
--
-- Expand-only (ADR-066 / audit P1-H): solo ADD COLUMN.
--   * empresas.carbon_measurement_enabled — NOT NULL DEFAULT false. El DEFAULT
--     constante materializa en catálogo en Postgres 11+ (sin reescritura
--     bloqueante de filas existentes); las empresas legacy quedan en false
--     (opt-out) de forma consistente.
--   * viajes.carbon_measurement_override — nullable sin default. NULL = heredar
--     el opt-in de la empresa; true/false fuerza/desactiva por viaje.
-- Sin DROP, sin RENAME, sin SET NOT NULL retroactivo. Ninguna columna tiene FK
-- ni constraint obligatorio desde otra tabla → el reverse manual (down/0046)
-- simplemente las dropea. Rollback de la revisión Cloud Run seguro: una versión
-- previa ignora ambas columnas. Ver docs/runbooks/db-migration-rollback.md.
--
-- Nota: `trips` (const Drizzle) mapea a la tabla SQL `viajes`.

ALTER TABLE empresas
  ADD COLUMN carbon_measurement_enabled boolean NOT NULL DEFAULT false;
--> statement-breakpoint

ALTER TABLE viajes
  ADD COLUMN carbon_measurement_override boolean;
