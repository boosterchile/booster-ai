-- Migration 0064 — lat/lng del destino del viaje.
--
-- El origen ya tiene origin_latitude / origin_longitude (0054). El destino
-- no: el pin, la sugerencia de Places o un link de Google Maps no tenían
-- dónde guardarse. Estas columnas lo persisten cuando el generador marca
-- el punto. NULL = viaje anterior o destino solo textual.
--
-- Expand-only: ADD COLUMN, numeric(10,7), nullable, sin default, sin
-- backfill. Una revisión previa ignora las columnas. Naming inglés, igual
-- que el par del origen (decisión PO en 0054). `trips` mapea a `viajes`.

ALTER TABLE viajes
  ADD COLUMN destination_latitude numeric(10, 7);
--> statement-breakpoint

ALTER TABLE viajes
  ADD COLUMN destination_longitude numeric(10, 7);
