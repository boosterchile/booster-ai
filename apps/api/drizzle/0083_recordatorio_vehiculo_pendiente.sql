-- Migration 0083 — Marcas de idempotencia del job de recordatorios cuando
-- la asignación/ruta sigue sin vehículo (matching-desde-la-carga §3.9 /
-- §11-3, parte 5).
--
-- El job recuerda a la oficina 24 h y 2 h antes del inicio de la ventana de
-- recogida, y avisa al generador si la ventana ya empezó sin vehículo. Cada
-- etapa se marca una sola vez para no spamear.
--
-- Expand-only (ADR-066): tres columnas nullable nuevas. No toca filas
-- existentes. Rollback de la revisión Cloud Run seguro: una versión previa
-- no lee estas columnas.

ALTER TABLE "asignaciones" ADD COLUMN "recordatorio_vehiculo_24h_en" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "asignaciones" ADD COLUMN "recordatorio_vehiculo_2h_en" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "asignaciones" ADD COLUMN "aviso_generador_sin_vehiculo_en" timestamp with time zone;
