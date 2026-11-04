-- Migration 0065 — decisión de fuente de la huella (HC-001 wiring).
--
-- Expand-only: ADD COLUMN nullable, sin default, sin backfill, sin NOT NULL.
-- Filas existentes quedan NULL (= decisión no registrada). Los valores válidos
-- viven en listas cerradas del código (decidir-fuente-huella.ts), no en un
-- enum de Postgres, para no requerir ALTER TYPE al versionar la regla.

ALTER TABLE metricas_viaje ADD COLUMN fuente_distancia varchar(20);
--> statement-breakpoint
ALTER TABLE metricas_viaje ADD COLUMN fuente_energia varchar(20);
--> statement-breakpoint
ALTER TABLE metricas_viaje ADD COLUMN motivo_fallback varchar(40);
--> statement-breakpoint
ALTER TABLE metricas_viaje ADD COLUMN decision_version smallint;
--> statement-breakpoint
ALTER TABLE metricas_viaje ADD COLUMN decidido_en timestamp with time zone;
--> statement-breakpoint
ALTER TABLE metricas_viaje ADD COLUMN peso_declarado boolean;
