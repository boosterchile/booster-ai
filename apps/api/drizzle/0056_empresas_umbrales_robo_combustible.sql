-- Migration 0056 — umbrales de aviso de robo de combustible por empresa.
--
-- Slice 2 del historial Teltonika: el dueño|admin fija U_empresa del golpe
-- único (5–20 L, default de dominio 8) y U_hormiga (8–30 L, default 10).
-- NULL = sin override; el cálculo on-read aplica el default. El 2 % del
-- estanque, si se conoce, sigue como piso del golpe y no se persiste acá.
--
-- Expand-only (ADR-066): solo ADD COLUMN nullable, sin default y sin
-- reescritura de filas. Los CHECK rechazan valores fuera de rango. Una
-- revisión previa de Cloud Run ignora las columnas. Reverse manual en
-- drizzle/down/0056_empresas_umbrales_robo_combustible.down.sql.

ALTER TABLE empresas
  ADD COLUMN umbral_robo_golpe_l integer,
  ADD COLUMN umbral_robo_hormiga_l integer;
--> statement-breakpoint

ALTER TABLE empresas
  ADD CONSTRAINT empresas_umbral_robo_golpe_l_rango
    CHECK (umbral_robo_golpe_l IS NULL OR (umbral_robo_golpe_l >= 5 AND umbral_robo_golpe_l <= 20));
--> statement-breakpoint

ALTER TABLE empresas
  ADD CONSTRAINT empresas_umbral_robo_hormiga_l_rango
    CHECK (
      umbral_robo_hormiga_l IS NULL
      OR (umbral_robo_hormiga_l >= 8 AND umbral_robo_hormiga_l <= 30)
    );
--> statement-breakpoint

COMMENT ON COLUMN empresas.umbral_robo_golpe_l IS
  'Umbral de golpe único en litros para el aviso de posible robo de combustible. NULL = default 8 L. Rango 5–20.';
--> statement-breakpoint

COMMENT ON COLUMN empresas.umbral_robo_hormiga_l IS
  'Umbral de robo hormiga en litros. NULL = default 10 L. Rango 8–30.';
