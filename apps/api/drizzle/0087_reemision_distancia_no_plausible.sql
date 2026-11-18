-- Migration 0087 — Motivo de reemisión «distancia medida no plausible»
-- (spec reemision-distancia-no-plausible, §4).
--
-- Un certificado emitido con una distancia medida que no cubría el recorrido
-- (regla de distancia-medida-plausible, 2026-11-16) se reemite con la
-- estimación guardada y este motivo. La lista cerrada vive en
-- packages/certificate-generator/src/reemision.ts; la restricción la repite.
--
-- Reescribe la restricción con un valor más: la nueva es más laxa que la que
-- reemplaza, toda fila que hoy cumple una cumple la otra (versión 1 sin motivo,
-- o versión 2 por el factor). No toca filas. Rollback de la revisión Cloud Run
-- seguro: una versión previa del api no produce el valor nuevo. El guard
-- check-migration-safety marca cualquier DROP CONSTRAINT; el marcador de abajo
-- lo declara, como en 0076. Reverso manual en down/.
--
-- contract-phase: .specs/reemision-distancia-no-plausible (§4; no contrae: amplía el CHECK)

ALTER TABLE "certificados_viaje" DROP CONSTRAINT IF EXISTS "ck_certificados_viaje_motivo";
--> statement-breakpoint
ALTER TABLE "certificados_viaje" ADD CONSTRAINT "ck_certificados_viaje_motivo"
  CHECK (
    (version = 1 AND motivo_reemision IS NULL)
    OR (
      version > 1
      AND motivo_reemision IS NOT NULL
      AND motivo_reemision IN ('factor_impreso_no_corresponde', 'distancia_medida_no_plausible')
    )
  );
