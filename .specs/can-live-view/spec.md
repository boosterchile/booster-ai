# spec — CAN en vivo: mapear LVCAN + mostrarlo en `/vehiculos/:id/live` (capa 0+1)

**Slug**: `can-live-view`
**Origen**: recon telemetría (PLFL57 imei 860693084796730 persiste CAN LVCAN 81-90 en `telemetria_puntos.io_data` crudo, solo con motor encendido). Ver [[telemetria-fmc150-can-fuel-gap-2026-07]].
**Naturaleza**: aditivo, UI + mapeo. Cero cambios de runtime del pipeline de ingesta, cero migración, cero cambios al cálculo de carbono.

## Objetivo

Mostrar 3 parámetros CAN al ver un vehículo en vivo, clonando el patrón ya existente de temperatura (IO 72). El dato ya se persiste crudo en `io_data`; falta (0) mapearlo formalmente y (1) exponerlo/mostrarlo.

## Entradas (verificado, primera fuente)

- `io_data` jsonb `{String(id): value}` en `telemetria_puntos` (persist.ts). Solo trae CAN con motor encendido.
- AVL IDs CAN confirmados en PLFL57 (escalas Teltonika LVCAN): **81** vehicle speed (km/h), **84** fuel level (raw ×0.1 L), **85** engine RPM, **89** fuel level (%).
- Molde exacto: `interpret-dallas-temperature.ts` (intérprete puro/tolerante) + `extractTemperatura` (vehiculos.ts) + `TemperaturaStat` (vehiculo-live.tsx). El DTO `ubicacion` tiene espejo **manual** en `UbicacionResponse` (cliente).

## Salidas

- **Capa 0**: `packages/shared-schemas/src/avl-ids/can-lvcan.ts` (catálogo) + `interpret-can-lvcan.ts` (intérprete) + exports en `index.ts`. Mapea 81/84/85/89. Aditivo.
- **Capa 1a**: `extractCan(io_data)` en `vehiculos.ts` (clon de `extractTemperatura`, Zod boundary, null-safe).
- **Capa 1b**: DTO `ubicacion` + espejo `UbicacionResponse` con `can_speed_kmh`, `fuel_pct`, `rpm`.
- **Capa 1c**: `FuelStat`/`RpmStat`/`CanSpeedStat` en el `bottomExtra` de `LiveTrackingScreen` (vehiculo-live.tsx), junto a `TemperaturaStat`. **Solo esos 3.**

## Criterios de éxito

1. Intérprete CAN puro: 81/84/85/89 escalados correctos; ID fuera de catálogo → unknown; RAW fuera de rango → invalid; ausente → telemetry vacío, no tira.
2. `extractCan`: ping con CAN (io_data real PLFL57) → valores; ping SIN CAN (motor apagado) → todos null, no rompe.
3. Endpoint `/ubicacion`: con punto CAN incluye los 3 campos; sin CAN, nulls. Espejo cliente matchea.
4. Regresión: temperatura (IO 72) sigue funcionando; DTO existente intacto.
5. `pnpm test` + `tsc` + `biome` verdes.

## Fuera de alcance

- Fuel consumed (83) / mileage (87) / fuel level L (84) en la **vista** — reservados para el historial por carga (capa 2). (84 se mapea en capa 0, pero NO se muestra en vivo.)
- Cálculo de carbono `exacto_canbus` (capa posterior).
- Cambios al pipeline de ingesta / schema BD.
