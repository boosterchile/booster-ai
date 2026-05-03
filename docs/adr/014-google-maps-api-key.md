# ADR-014 — API Key de Google Maps (Web PWA)

**Fecha:** 2026-05-02
**Estado:** Aceptado

## Contexto

Slice de mapas en la PWA: visualizar la ubicación actual de vehículos con Teltonika
asociado, tanto para el transportista (en `/app/vehiculos/:id`) como para el shipper
(en `/app/cargas/:id` cuando hay vehículo asignado). El frontend usa
`@vis.gl/react-google-maps` que requiere una API key del servicio JS de Google Maps.

Antes de este slice, el proyecto solo tenía 1 API key auto-creada por Firebase
(propósito: SDK web Firebase Auth). Maps JS API NO estaba habilitada.

## Decisión

Crear una **API key dedicada para Google Maps Platform**, separada de la key Firebase,
con restricciones específicas para el dominio público de la PWA.

### Configuración

- **Nombre**: `Booster Maps - Web (PWA)`
- **Project**: booster-ai-494222
- **Creada por**: dev@boosterchile.com
- **Fecha**: 2026-05-02
- **Restricción de aplicación**: HTTP referrers
  - `https://app.boosterchile.com/*`
- **Restricción de APIs**: las 33 APIs habilitadas en el proyecto (default).
  La protección efectiva para una key web viene del HTTP referrer, no de
  la lista de APIs (ya que el client-side bundle expone la key en el HTML).

### APIs habilitadas

- Maps JavaScript API (habilitada en este slice)
- Otras APIs Maps quedan disponibles para futuros slices (Geocoding,
  Distance Matrix, Routes, Places).

### Costos esperados

Google Maps Platform ofrece **$200 USD de crédito mensual gratis** que cubre:
- ~28.500 cargas dinámicas de Maps JS API por mes

Estimado para piloto:
- 10 users activos
- ~50 cargas de mapa / user / día
- = 15.000 cargas/mes → **dentro del free tier**

Después del free tier: $7 USD por 1000 cargas adicionales.

## Cómo se usa

### En código

```ts
// apps/web/src/lib/env.ts
VITE_GOOGLE_MAPS_API_KEY: z.string().optional()  // optional para que dev local
                                                  // sin key arranque

// apps/web/src/components/map/VehicleMap.tsx
import { APIProvider, Map, AdvancedMarker, Pin } from '@vis.gl/react-google-maps';

<APIProvider apiKey={env.VITE_GOOGLE_MAPS_API_KEY}>
  <Map ... />
</APIProvider>
```

Si `VITE_GOOGLE_MAPS_API_KEY` no está set en el bundle, el componente cae al
fallback "Mapa no disponible" sin romper la PWA.

### En CI/CD

`deploy-phase-2.sh` pasa la key como substitución a Cloud Build:

```bash
SUBS="${SUBS},_VITE_GOOGLE_MAPS_API_KEY=AIzaSyAVy84hArL08alVL2JEGfNCgTSqu4eTyNg"
```

`cloudbuild.production.yaml` la inyecta como `--build-arg` al Dockerfile del web,
que la pasa como `ENV VITE_GOOGLE_MAPS_API_KEY` al `pnpm --filter @booster-ai/web build`.
Vite la reemplaza textualmente en el bundle final servido al cliente.

## Alternativas rechazadas

### A) Reusar la key auto-creada por Firebase

Rechazado porque:
- Tiene scope distinto (Firebase SDK ≠ Maps Platform)
- Su HTTP referrer estaba configurado para Firebase Hosting (URLs *.firebaseapp.com),
  no para `app.boosterchile.com`
- Mezclar propósitos en una sola key dificulta auditoría y rotación

### B) Maps Static API en lugar de JS API

Rechazado porque:
- No permite polling/actualización del marker dinámicamente
- Mostrar ubicación cambiante de un vehículo en tiempo real requiere JS API
- El costo es similar para nuestros volúmenes

### C) Leaflet + OpenStreetMap (gratis)

Rechazado porque:
- Tiles de OSM son free pero el rendering no es tan bueno para Chile
- Requiere instalación de leaflet + react-leaflet, librería distinta
- Si ya tenemos Google Maps Platform habilitada para futuros features
  (Geocoding, Routes), conviene unificar
- Ahorro de $0/mes mientras estemos dentro del free tier no justifica

## Mitigación de costos

Si Maps JS API se acerca al free tier:
1. Cache del último point por sesión (no re-cargar mapa al cambiar tab)
2. Reducir polling de 30s → 60s
3. Deshabilitar mapa en `/app/cargas/:id` si la carga está completada (status='entregada')

## Rotación

La key vive en código (`deploy-phase-2.sh` y `cloudbuild.production.yaml` substitution
default). Para rotar:
1. Crear key nueva en GCP Console con mismas restricciones
2. Actualizar `_VITE_GOOGLE_MAPS_API_KEY` en `deploy-phase-2.sh`
3. Deploy
4. Borrar key vieja desde GCP Console

Como la key está expuesta en el bundle JS al cliente (es la naturaleza de las
keys "browser"), su seguridad NO depende de mantenerla secreta sino de la
restricción HTTP referrer + cuotas de Google.
