-- Migration 0060 — Suscripciones en UF (ADR-079 §4, .specs/modelo-comercial-v3 PR 5).
--
-- Expand-only: una tabla nueva y dos columnas nulas. Nada lee esto mientras
-- PRICING_V3_ACTIVATED = false.
--
-- valores_uf: valor de la UF por día, con la fuente que lo entregó (CMF,
-- con respaldo SII). La factura captura su propio uf_valor_clp (0059); esta
-- tabla es la caché auditada de donde sale ese valor.

CREATE TABLE IF NOT EXISTS "valores_uf" (
	"fecha" date PRIMARY KEY NOT NULL,
	"valor_clp" numeric(12, 2) NOT NULL,
	"fuente" text NOT NULL,
	"obtenido_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_valores_uf_valor" CHECK ("valor_clp" > 0),
	CONSTRAINT "chk_valores_uf_fuente" CHECK ("fuente" IN ('cmf', 'sii'))
);
--> statement-breakpoint

-- ADR-079 §4: plan de transportista con gestión de flota. Decisión manual
-- del platform-admin por empresa (igual que el contrato programado).
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "gestion_flota_activada_en" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "gestion_flota_activada_por" text;
