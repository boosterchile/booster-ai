-- Migration 0054 — lat/lng del origen del viaje (plan medicion-huella-segmento, Task 2)
--
-- Persiste la posición geocodificada del origen del viaje. Es el ancla del
-- geofence de recogida (Task 8: la PWA del conductor sugiere "confirmar
-- recogida" cuando su posición entra al radio del origen) que abre la ventana
-- pickedUpAt → deliveredAt sobre la que se mide la huella. La geocodificación
-- (Routes API) y su persistencia viven en Task 4; esta migración solo crea las
-- columnas.
--
-- Naming inglés total (decisión PO): columnas nuevas en snake_case inglés,
-- divergiendo a propósito de las legadas en español (origen_direccion_raw,
-- origen_codigo_region). Las legadas NO se migran.
--
-- Expand-only (ADR-066 / audit P1-H): solo ADD COLUMN, nullable, sin default.
--   * viajes.origin_latitude  — numeric(10,7) NULL.
--   * viajes.origin_longitude — numeric(10,7) NULL.
--   NULL = sin geocodificar (viaje anterior a la migración, o geocodificación
--   degradada sin bloquear la creación del viaje). NUNCA 0/0 como default: un
--   origen en (0,0) sería un geofence real en el Golfo de Guinea. Misma
--   precisión que posiciones_movil_conductor.latitud/longitud.
-- Sin DROP, sin RENAME, sin SET NOT NULL retroactivo, sin backfill: no hay
-- reescritura de filas existentes. Ninguna columna tiene FK ni constraint
-- desde otra tabla → el reverse manual (down/0054) simplemente las dropea.
-- Rollback de la revisión Cloud Run seguro: una versión previa ignora ambas
-- columnas. Ver docs/runbooks/db-migration-rollback.md.
--
-- Nota: `trips` (const Drizzle) mapea a la tabla SQL `viajes`.

ALTER TABLE viajes
  ADD COLUMN origin_latitude numeric(10, 7);
--> statement-breakpoint

ALTER TABLE viajes
  ADD COLUMN origin_longitude numeric(10, 7);
