-- Migration 0079 — Vehículo opcional en la asignación y unidad de tercero
-- (ADR-090, spec matching-desde-la-carga, parte 3).
--
-- Hoy aceptar una oferta fija un camión: `asignaciones.vehiculo_id` es
-- obligatorio. ADR-090 separa las dos cosas: la empresa acepta la carga y
-- declara el vehículo al despachar, en la ruta (ADR-088). Y la transportista
-- puede registrar un vehículo que no es suyo, marcado como unidad de tercero.
--
-- Esta migración solo abre el esquema. Ningún código escribe todavía una
-- asignación sin vehículo ni una unidad de tercero: eso es la parte 4.
--
-- Expand-only (ADR-066): relaja una restricción y agrega una columna con
-- valor por defecto. No toca filas existentes. Rollback de la revisión Cloud
-- Run seguro: una versión previa nunca lee un `vehiculo_id` nulo porque nadie
-- lo escribe, y no conoce `es_de_tercero`.

ALTER TABLE "asignaciones" ALTER COLUMN "vehiculo_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "vehiculos" ADD COLUMN "es_de_tercero" boolean DEFAULT false NOT NULL;
