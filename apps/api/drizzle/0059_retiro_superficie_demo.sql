-- Migration 0059 — retiro de la superficie demo (fase contract).
--
-- contract-phase: T10-03 PR 1 (#745, retiro de la maquinaria demo)
--
-- El expand fue el PR 1: el código dejó de leer y escribir `empresas.es_demo`
-- y `cuentas_demo`. Esta migración va en un release POSTERIOR al del PR 1,
-- cuando ninguna revisión viva consulta la columna (ver
-- .specs/retiro-superficie-demo-t10-03/spec.md §4).
--
-- Guarda: sin `es_demo`, una empresa demo sería indistinguible de una real
-- (métricas, facturación). El PR 1 dejó de filtrar por la columna porque
-- tenía 0 filas en true; si eso cambió, o si queda una cuenta demo activa,
-- la migración aborta sin tocar nada y el release no avanza.
-- Diagnóstico:
--   SELECT id, razon_social FROM empresas WHERE es_demo;
--   SELECT persona, email FROM cuentas_demo WHERE deshabilitado_en IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "empresas" WHERE "es_demo") THEN
    RAISE EXCEPTION '0059: hay empresas con es_demo = true; retirarlas antes del DROP';
  END IF;
  IF EXISTS (SELECT 1 FROM "cuentas_demo" WHERE "deshabilitado_en" IS NULL) THEN
    RAISE EXCEPTION '0059: hay cuentas_demo activas (deshabilitado_en IS NULL); deshabilitarlas antes del DROP';
  END IF;
END $$;
--> statement-breakpoint
DROP TABLE "cuentas_demo";
--> statement-breakpoint
DROP TYPE "persona_demo";
--> statement-breakpoint
ALTER TABLE "empresas" DROP COLUMN "es_demo";
