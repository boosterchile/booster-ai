# Distancia de la huella: Routes API rechaza el body y la tabla de respaldo no conoce `XIII`

**Estado**: aceptada (fix dentro del Slot 1) · **Fecha**: 2026-09-22 · **Slot**: 1 «Huella de carbono punta a punta» · **Origen**: inventario de pendientes 2026-09-22 — los 4 viajes móviles del 21-09 cerraron con `cobertura_pct = 0`, `fuente_dato_ruta = maps_directions` y sin `emisiones_kgco2e_reales` aunque el teléfono sí reportó posiciones.

## 1. El problema (medido en producción)

Hay tres defectos en la misma cadena. Los tres dejan la distancia de la huella en un número inventado sin que nada falle de forma visible.

### A. Una coordenada viaja como dirección de texto

`computeRoutes` arma siempre `origin: { address }` / `destination: { address }`. Tres llamadores le pasan coordenadas como texto `"lat,lng"`:

| Llamador | Desde | Efecto |
|---|---|---|
| relleno de huecos post-entrega (`calcular-metricas-viaje.ts`, `estimarHuecoKm`) | #624 (2026-07-25) | la reconstrucción de la distancia real **aborta** con `abortReason = routes_error` → `cobertura_pct = 0`, `fuente_dato_ruta = maps_directions`, huella real `null` |
| backfill de distancia (`backfill-distancia-adapters.ts`) | #624 | mismo abort para cada viaje candidato |
| ETA del tracking en vivo (`compute-route-eta.ts`) | #144 (2026-05-10) | ETA por Routes nunca funciona; cae al centroide |

Routes API responde `400 INVALID_ARGUMENT`: «LatLng: "-33.4828167,-70.5966552" cannot be specified as an Address Waypoint». En Cloud Logging, el 2026-09-21 hay decenas de estas respuestas y «recalcular: reconstrucción abortada — Routes falló (roto)» para BOO-KJHITL (12:38Z), BOO-LCTSE5 (15:51Z) y BOO-83ND2C (19:39Z). BOO-PMGQWN (16:09Z) es `sin_observacion` legítimo.

### B. `vehicleInfo` va en la raíz del body

Desde #96 (2026-05-10), cuando hay `emissionType` se manda `body.vehicleInfo = { emissionType }`. En Routes API v2 ese campo vive en `routeModifiers.vehicleInfo`. Todo request con tipo de combustible responde `400` «Unknown name "vehicleInfo": Cannot find field». Pasa por dos caminos:

- al aceptar la oferta (`obtenerDistanciaKm`), que es donde se fija `distancia_km_estimada`;
- en el eco-preview de la oferta (`eco-route-preview.ts`).

En ambos casos el catch cae a la tabla por regiones y la estimación nunca vino de Routes. Logs del 21-09 a las 12:12, 13:42, 16:03 y 16:25Z: «Routes API falló, fallback a estimarDistanciaKm», con `httpStatus: 400`. El `errBody` no se ve porque a ese llamador no se le pasa `logger`, y el logger pierde el `message` de los `Error`.

### C. La tabla de respaldo no reconoce la Región Metropolitana

`estimar-distancia.ts` (desde 2026-05-02) usa la clave `RM`. El enum canónico `regionCodeSchema` usa `XIII` y no acepta `RM`. Resultado: todo viaje XIII → otra región cae al default de **500 km**.

### Reproducción contra la API real (2026-09-22, ADC, 5 llamadas)

| # | Body | HTTP |
|---|---|---|
| 1 | `origin: { address: "-33.4828167,-70.5966552" }` | 400 «cannot be specified as an Address Waypoint» |
| 2 | `origin: { location: { latLng: { latitude, longitude } } }` | 200 (1997 m) |
| 3 | direcciones de texto + `vehicleInfo` en la raíz + `FUEL_CONSUMPTION` | 400 «Unknown name "vehicleInfo"» |
| 4 | las mismas direcciones sin `vehicleInfo` | 200 (120.968 m) |
| 5 | las mismas direcciones + `routeModifiers.vehicleInfo.emissionType = DIESEL` + `FUEL_CONSUMPTION` | 200 (121.132 m, `travelAdvisory` vacío: en Chile Routes no estima combustible) |

### Estado en prod (solo lectura, `scripts/db/agent-query.sh`)

| Viaje | Regiones | `distancia_km_estimada` | Distancia real (Routes, caso 4) | Nivel | Certificado |
|---|---|---|---|---|---|
| BOO-KJHITL | XIII → V | **500,00** (default por C) | ~121 km | `secundario_modeled` | emitido |
| BOO-LCTSE5 | IV → IV | 30,00 (intra-regional) | — | `secundario_modeled` | emitido |
| BOO-PMGQWN | IV → IV | 30,00 | — | `secundario_modeled` | emitido |
| BOO-83ND2C | XIII → XIII | 30,00 | — | `secundario_modeled` | emitido |
| BOO-BKAXIK | XIII → IV | **500,00** | medida 2,51 (Teltonika) | `secundario_modeled` | emitido |

## 2. Entradas y salidas

**Sin cambio de contrato HTTP, de schema de BD ni de fórmulas GLEC.** Cambia el body que el API manda a Google y la tabla interna de respaldo.

- `apps/api/src/services/routes-api.ts`
  - `origin` / `destination` aceptan `string | RouteLatLng`. Un texto sigue yendo como `{ address }`; una coordenada va como `{ location: { latLng: { latitude, longitude } } }`.
  - `emissionType` va en `routeModifiers.vehicleInfo.emissionType`. `extraComputations: ['FUEL_CONSUMPTION']` y el field mask no cambian.
- Los llamadores con coordenadas pasan `{ lat, lng }`: `calcular-metricas-viaje.ts` (relleno de huecos), `backfill-distancia-adapters.ts` y `compute-route-eta.ts`.
- `logger` se pasa a `computeRoutes` en el relleno de huecos, en el backfill y en `obtenerDistanciaKm`, para que un 400 futuro deje su `errBody` en el log. El `catch {}` del backfill deja de tragarse el error en silencio: lo loguea y conserva `abortReason = routes_error`.
- `apps/api/src/services/estimar-distancia.ts`: `XIII` se trata como alias de `RM` en el lookup.

## 3. Impacto que el PO debe conocer (no es un cambio de contrato, pero sí de números)

1. **El camino híbrido de #624 se activa por primera vez en prod.** Hasta hoy abortaba siempre que había un hueco ≥ 60 s. Los próximos viajes con pings pueden salir de `maps_directions` / cobertura 0 y llegar a una distancia real y un nivel distintos. Siguen rigiendo el umbral del 80 % y la regla de ADR-077 de que el móvil nunca da primario. La decisión abierta ADR-077 estricta vs híbrida (`medicion-huella-segmento/plan.md`) **no** se toca.
2. **`distancia_km_estimada` de los viajes nuevos pasa de la tabla por regiones a Routes** cuando el vehículo tiene tipo de combustible. Es lo que especificaba #96 y nunca funcionó. En un viaje intra-regional deja de ser 30 km fijos y pasa a ser la ruta real.
3. **Los 5 certificados ya emitidos no se tocan.** Re-derivarlos o recalcularlos es gate del PO por su impacto legal/ESG.

## 4. Fuera de alcance (declarado)

- Recalcular o re-certificar los viajes ya cerrados (BOO-KJHITL, LCTSE5, PMGQWN, 83ND2C, BKAXIK).
- Correr el backfill de distancia (#624). Sigue detrás del gate del PO y del plazo de `bitacora_backfill_distancia`.
- Decidir la lectura estricta o híbrida de ADR-077.
- Serializar `message`/`stack` de los `Error` en `@booster-ai/logger`: es Observabilidad, congelada. Se reporta.
- Completar o recalibrar la tabla por regiones más allá del alias `XIII`.
- Filtro de `e2e-pr.yml`: no incluye `apps/api/src/**`, así que este PR no corre el Playwright del conductor. Tocar ese quality gate es del PO.

## 5. Criterios de salida

- [ ] Rojo exhibido (dominio crítico: huella/GLEC):
  - (A) test de `computeRoutes`: una coordenada sale como `location.latLng`, no como `address`;
  - (B) test de `computeRoutes`: `emissionType` sale en `routeModifiers.vehicleInfo` y no en la raíz;
  - (A) relleno de huecos, backfill y ETA mandan coordenadas y no el string `"lat,lng"`;
  - (C) `estimarDistanciaKm('XIII', 'V')` es igual a `RM → V`, no 500.
- [ ] Verde: esos tests más la suite de `apps/api`, `tsc --noEmit`, biome y build, con el output en `## Evidencia` del PR.
- [ ] En prod, tras el deploy manual del PO: cero logs «cannot be specified as an Address Waypoint» y «Unknown name "vehicleInfo"», y el próximo viaje móvil con huecos no aborta con `routes_error`.
