-- Migration 0063 — Auditoría de la activación del rol generador (historia 0).
--
-- Expand-only: dos columnas nulas sobre `empresas`. El flag
-- `es_generador_carga` ya existe. Estas columnas registran quién (email del
-- platform-admin) y cuándo lo prendió sobre un transportista que ya existía.
-- NULL = el flag vino del alta, o la empresa todavía no es generador.
-- Una segunda activación no reescribe estos campos.

ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "generador_carga_activado_en" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "generador_carga_activado_por" text;
