# Spec — fix/ecoroute-bounds-core-typecheck

## Contexto

Recon post-#600 (2026-07-16) halló la segunda y última mina de la clase: `RoutePolyline`
en `apps/web/src/components/offers/EcoRouteMapPreview.tsx:148` construye
`new mapsLib.LatLngBounds(...)` con `mapsLib = useMapsLibrary('maps')`; `LatLngBounds`
vive en `CoreLibrary`. Se alcanza siempre con polyline decodificada no vacía (el guard de
0 puntos ya pasó y `boundsOf` solo devuelve null con lista vacía). Monta en
`OfferCard.tsx:329` y `AssignmentEcoRouteCard.tsx:96` (flujos eco-ruta). Invisible hoy:
el test mockeaba `useMapsLibrary: () => null` y el web no tiene sink de errores client-side.

Causa raíz compartida con #600: `@types/google.maps` nunca entraba al programa de tsc
(no declarado en apps/web, sin triple-slash en el d.ts de @vis.gl, `types` restrictivo)
→ `google.maps.*` degradaba a `any` vía `skipLibCheck`.

## Entradas / salidas

- **Entrada**: `EcoRouteMapPreview` con `polylineEncoded` válida (≥1 punto) y API key.
- **Salida**: polyline dibujada + `map.fitBounds(bounds, 32)` sin excepción, con bounds
  de la librería `core`. Y el compilador rechazando cualquier símbolo pedido a la
  librería equivocada (clase cerrada, no solo la instancia).

## Criterios de éxito

1. `coreLib = useMapsLibrary('core')` para `LatLngBounds`; `'maps'` se mantiene para
   `Polyline` (:134, sí vive ahí). Guard extendido con `!coreLib` y deps del effect.
2. Typecheck real: `@types/google.maps@^3.64.0` en devDeps de apps/web + `"google.maps"`
   en `types` del tsconfig. **Control exhibido**: tsc pre-fix falla con exactamente
   1 error = la :148 (`TS2339 Property 'LatLngBounds' does not exist on type 'MapsLibrary'`),
   confirmando la predicción del recon (sin fallout de alcance).
3. Regresión runtime con mock de forma real ('core' CON LatLngBounds construible;
   'maps' → { Polyline } SIN LatLngBounds). **Rojo exhibido** contra el código previo
   (mismo TypeError de prod); verde con el fix. Sin crash movido a extend: acá no hay
   loop de extend — bounds se construye con esquinas literales finitas (decodePolyline
   produce números finitos por construcción).
4. `tsc --noEmit` exit 0 post-fix, suite web completa verde, biome verde.
5. PR abierto contra `main`; sin merge ni deploy (los hace el PO).
