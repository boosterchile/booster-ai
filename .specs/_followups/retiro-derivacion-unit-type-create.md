# Retiro de la derivación server-side de `unit_type` en create (fix C1)

**Dimensión**: dominio / api · **Estado**: deuda explícita aceptada por el PO (fix C1, decisión opción b, 2026-07-06), con criterio de retiro definido en este stub.
**Fuente**: review W4a, finding Critical C1 — decisión documentada en `docs/adr/073-tipologias-flota-configuracion-glec.md` §"Caveat C1 runtime".

## Problema

`POST /vehiculos` (`apps/api/src/routes/vehiculos.ts`) deriva `unit_type`/`unit_category`/`body_type` desde el `vehicle_type` legacy (`derivarUnidadDesdeTipoLegacy`, `packages/shared-schemas/src/domain/vehicle.ts`) cuando el body no manda `unit_type` explícito. Esto existe SOLO porque el form web actual (`apps/web/src/routes/vehiculos.tsx`, `vehicleFormToBody`) todavía no manda ese campo — W4a lo había hecho obligatorio vía Zod, lo que rompía el form (finding C1 del review). El fix (opción b del PO) evitó romper el form derivando server-side, en vez de bloquear el create o relajar la validación de coherencia.

La derivación usa el MISMO mapping D4 del backfill de la migración 0048 y hereda su mismo caveat D4.1: el enum legacy no tiene un valor "tracto" — un `camion_pesado` real del piloto (que en la práctica podría ser un tracto camión) se deriva hoy como `camion_rigido`, igual que en el backfill. Mientras esta rama exista, cada create nuevo vía form puede seguir alimentando el mismo riesgo de mala clasificación que las filas legacy backfilled, en vez de forzar al usuario a declarar la unidad real.

## Impacto de dejarlo indefinidamente

- Filas nuevas potencialmente mal clasificadas (mismo riesgo que el backfill legacy), no solo las que ya existían antes de la migración 0048.
- El mapping D4 vive triplicado en espíritu (comentario SQL del backfill, `derivarUnidadDesdeTipoLegacy`, ADR-073) — mientras la derivación en create siga activa, cualquier cambio a la taxonomía legacy→nueva debe revisar los tres lugares para no divergir.

## Mitigación mientras tanto (condición 1 del fix C1)

Cada disparo de la derivación queda logueado estructuradamente (`apps/api/src/routes/vehiculos.ts`, `logger.info` con `vehicleType` origen, `derivedUnitCategory`/`derivedUnitType`/`derivedBodyType`, `empresaId`, `vehicleId` resultante — mensaje `'unit_type derivado desde vehicle_type en create (fix C1, ADR-073 §Caveat C1 runtime)'`). Esto permite contar cuántos creates reales están cayendo en esta ruta y auditarlos manualmente en la UI de flota (W4b), igual que el caveat D4.1 del backfill.

## Criterio de retiro (cualquiera de las dos condiciones cierra este stub)

1. **Form actualizado**: el form web (W4b) agrega el selector de `unit_type` (+ `unit_category`/`body_type` si corresponde) y lo manda explícito en todo create — la rama de derivación deja de dispararse en la práctica (el log de la condición 1 cae a 0 de forma natural).
2. **0 disparos del log en N días**: el log estructurado de la condición 1 registra cero eventos de derivación durante N días de operación real del piloto (N a definir por el PO al revisar el volumen de creates — sugerido 14 días corridos con el piloto activo, vía Cloud Logging/BigQuery sink), señal de que en la práctica todos los creates ya mandan `unit_type` por otra vía (ej. import/backoffice).

Cuando se cumpla 1 o 2: volver `unit_type` obligatorio en `createBodySchema` (como estaba antes del fix C1, D4.2 original) y eliminar la rama de derivación + el log asociado en `apps/api/src/routes/vehiculos.ts`. `derivarUnidadDesdeTipoLegacy` puede conservarse en `shared-schemas` si sigue siendo útil para otro consumidor (ej. herramienta de reconciliación manual de W4b sobre las filas backfilled), o retirarse también si deja de tener consumidores.

## Referencia

- Decisión: Critical C1 del review W4a, opción b del PO, 2026-07-06.
- `docs/adr/073-tipologias-flota-configuracion-glec.md` §"Caveat C1 runtime" (mismo caveat D4.1 heredado en runtime, con la mitigación).
- Código: `apps/api/src/routes/vehiculos.ts` (`POST /`), `packages/shared-schemas/src/domain/vehicle.ts` (`derivarUnidadDesdeTipoLegacy`).
- Caveat original: ADR-073 §5 (mapping/backfill D4.1), `apps/api/drizzle/0048_tipologias_flota.sql` §3.
