# Spec — fix/fleetmap-bounds-core

## Contexto

Outage en prod `/app/flota` (2026-07-15): `TypeError: l.LatLngBounds is not a constructor`
en `apps/web/src/components/map/FleetMap.tsx:152`. `AutoFitBounds` pide `LatLngBounds` a
`useMapsLibrary('maps')`, pero ese constructor vive en la librería **`core`** de google.maps
(`CoreLibrary`), no en `MapsLibrary`. Latente desde `d7085a9` (2026-05-10, único commit del
archivo); se gatilló hoy al existir por primera vez ≥2 vehículos con posición en la misma
empresa (guards de 0 y 1 vehículo retornan antes de construir bounds). Recon completo en la
sesión 2026-07-15 (criterios (a)/(b)/(c): clasificado (b), deploy prod = main HEAD).

## Entradas / salidas

- **Entrada**: `FleetMap` con `vehicles` (≥2 con lat/lng finitos) y Google Maps API cargada.
- **Salida**: mapa encuadrado a los markers vía `map.fitBounds(bounds, 60)` sin excepción,
  con `bounds` construido desde la librería `core`.

## Criterios de éxito

1. `useMapsLibrary('core')` provee `LatLngBounds`; ningún acceso a `LatLngBounds` sobre la
   librería `maps`. Cambio mínimo: `mapsLib` solo alimenta el bounds (usos: :124 declaración,
   :143 guard, :152 constructor) → opción A del goal (cambiar la lib pedida).
2. Sin filtro nuevo en el loop de extend: `FleetMap` ya filtra `Number.isFinite(lat/lng)`
   antes de pasar `positioned` a `AutoFitBounds` (FleetMap.tsx:69-71,84).
3. Regresión en `FleetMap.test.tsx`: mock con forma real (`core` CON `LatLngBounds`
   construible con `.extend()`; `maps` SIN él); con ≥2 vehículos el render no tira y
   `fitBounds` se llama con los bounds extendidos por cada posición y padding 60.
   **Rojo exhibido** contra el código previo al fix; verde con el fix.
4. Suite completa de `@booster-ai/web` + typecheck verdes (node 24).
5. PR abierto contra `main` con Evidencia; sin merge ni deploy (los hace el PO).

## Fuera de scope

`@types/google.maps` ausente del typecheck (degrada `google.maps.*` a `any` vía
`skipLibCheck`) — goal aparte, documentado en el recon.
