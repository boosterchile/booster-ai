-- Migration 0080 — Métricas de la ruta y datos del reparto (ADR-089, spec
-- huella-consolidada, parte 2).
--
-- Hoy la huella se calcula y se guarda por viaje (`metricas_viaje`). Con
-- cargas consolidadas se calcula una vez por ruta y se reparte entre sus
-- servicios por toneladas-kilómetro. Esta migración agrega dónde guardarlo:
--
--   - `metricas_ruta`: la huella de la ruta completa, con su desglose, la
--     distancia, la actividad de transporte, el método, la fuente, el nivel
--     de certificación y la versión del método de reparto.
--   - en `metricas_viaje`: de qué ruta sale la parte del servicio, su
--     actividad (toneladas-kilómetro con distancia directa), su participación
--     en porcentaje y la versión del método de reparto.
--
-- Ningún código las escribe todavía: el cálculo sigue siendo por viaje hasta
-- la parte 3.
--
-- Expand-only (ADR-066): una tabla nueva y cuatro columnas opcionales. No toca
-- filas existentes. Rollback de la revisión Cloud Run seguro: una versión
-- previa no lee la tabla ni las columnas.
--
-- Los tipos numéricos repiten los de `metricas_viaje` para que una ruta de un
-- solo servicio guarde las mismas cifras en los dos lados.

CREATE TABLE "metricas_ruta" (
  "ruta_id" uuid PRIMARY KEY NOT NULL,
  "distancia_km_estimada" numeric(10, 2),
  "distancia_km_real" numeric(10, 2),
  "actividad_tkm" numeric(14, 3),
  "emisiones_kgco2e_estimadas" numeric(10, 3),
  "emisiones_kgco2e_reales" numeric(10, 3),
  "emisiones_kgco2e_ttw" numeric(10, 3),
  "emisiones_kgco2e_wtt" numeric(10, 3),
  "intensidad_gco2e_por_tkm" numeric(12, 3),
  "combustible_consumido_l_estimado" numeric(10, 2),
  "combustible_consumido_l_real" numeric(10, 2),
  "metodo_precision" "metodo_precision",
  "version_glec" varchar(10),
  "factor_emision_usado" numeric(8, 5),
  "factores_fuente" text,
  "fuente_dato_ruta" "fuente_dato_ruta",
  "cobertura_pct" numeric(5, 2),
  "nivel_certificacion" "nivel_certificacion",
  "factor_incertidumbre" numeric(4, 3),
  "version_metodo_reparto" varchar(40),
  "calculado_en" timestamp with time zone,
  "creado_en" timestamp with time zone DEFAULT now() NOT NULL,
  "actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "metricas_ruta_ruta_id_rutas_id_fk"
    FOREIGN KEY ("ruta_id") REFERENCES "rutas"("id") ON DELETE RESTRICT,
  CONSTRAINT "ck_metricas_ruta_actividad" CHECK ("actividad_tkm" IS NULL OR "actividad_tkm" >= 0),
  CONSTRAINT "ck_metricas_ruta_cobertura"
    CHECK ("cobertura_pct" IS NULL OR ("cobertura_pct" >= 0 AND "cobertura_pct" <= 100))
);
--> statement-breakpoint
CREATE INDEX "idx_metricas_ruta_calculado" ON "metricas_ruta" ("calculado_en");
--> statement-breakpoint
ALTER TABLE "metricas_viaje" ADD COLUMN "ruta_id" uuid;
--> statement-breakpoint
ALTER TABLE "metricas_viaje" ADD COLUMN "actividad_tkm" numeric(14, 3);
--> statement-breakpoint
ALTER TABLE "metricas_viaje" ADD COLUMN "participacion" numeric(5, 2);
--> statement-breakpoint
ALTER TABLE "metricas_viaje" ADD COLUMN "version_metodo_reparto" varchar(40);
--> statement-breakpoint
ALTER TABLE "metricas_viaje" ADD CONSTRAINT "metricas_viaje_ruta_id_rutas_id_fk"
  FOREIGN KEY ("ruta_id") REFERENCES "rutas"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "metricas_viaje" ADD CONSTRAINT "ck_metricas_viaje_actividad"
  CHECK ("actividad_tkm" IS NULL OR "actividad_tkm" >= 0);
--> statement-breakpoint
ALTER TABLE "metricas_viaje" ADD CONSTRAINT "ck_metricas_viaje_participacion"
  CHECK ("participacion" IS NULL OR ("participacion" >= 0 AND "participacion" <= 100));
--> statement-breakpoint
CREATE INDEX "idx_metricas_viaje_ruta" ON "metricas_viaje" ("ruta_id");
