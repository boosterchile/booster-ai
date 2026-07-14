# Spec — Distancia real híbrida (paso 1 del fix F0-0)

**Estado:** aceptada · **Fecha:** 2026-07-13 · **Owner:** Felipe Vicencio (PO, autorizó 2026-07-13)
**Origen:** hallazgo F0-0 (`.specs/telemetria-fmc150/hallazgo-distancia-medida-vs-estimada.md`).
**Cimiento:** ADR-028 §5 (cobertura por pings + gap 60s) — este paso lo **completa**: en vez de descartar
`kmCubiertos` conservando solo el ratio, persiste la **distancia real** del leg cargado.
**Dominio crítico (carbono/GLEC):** TDD con rojo exhibido obligatorio antes de implementar.

---

## Problema (una línea)
El certificado publica una distancia **estimada** (Routes API / tabla regional) bajo el campo
`distancia_km_real`, aun para el device con 260k pings GPS reales — porque `distancia_km_real` **nunca se
escribe** y el cert cae a `distanceKmEstimated` (`certificates.ts:128`).

## Alcance

### En alcance (paso 1)
- Nueva función que computa la **distancia real híbrida** de un trip con traza Teltonika:
  `distancia = Σ tramos observados (gap <60s, haversine) + Σ huecos (gap ≥60s, estimados por Routes)`.
- Persistir el resultado en `metricas_viaje.distancia_km_real` al cierre del trip (dentro de
  `recalcularNivelPostEntrega`, que ya corre con Teltonika presente).
- Persistir `coverage_pct` = `kmObservado / distanciaTotal × 100` (fracción **medida**), reutilizando la
  maquinaria de downgrade de ADR-028 §2.
- El certificado ya prefiere `distancia_km_real` (`certificates.ts:128`) → sin cambio ahí.
- **Regla de honestidad:** el cert declara *"medido X%, estimado (100−X)%"* cuando hay huecos. Nunca
  "distancia medida" a secas.

### Re-derivación de históricos (parte del paso 1, NO opcional)
El fix escribe `distancia_km_real` **hacia adelante**. Pero los viajes **ya calculados** con Teltonika
(ventana pickup→entrega cubierta por los 260k pings desde el 5-may) quedaron con distancia estimada. Sin
re-derivarlos, el resultado es distancia real para el futuro y **estimación para siempre en el pasado**.
- **Backfill:** por cada trip histórico con vehículo Teltonika y pings en su ventana, correr
  `calcularDistanciaHibrida` → actualizar `distancia_km_real` + `coverage_pct` (+ re-derivar nivel).
- **Ventana acotada:** solo posible mientras los pings estén en `telemetria_puntos`. Ligado al candado de
  retención (F0-0 §8.2, `.specs/telemetria-fmc150/`): NO purgar hasta que esta re-derivación corra.
- Certs históricos ya emitidos que cambien de número → reemitir (superficie hoy = 0, F0-0 §8.2).

### Fuera de alcance (pasos/PRs separados)
- **Recomputar EMISIONES** desde la distancia real (hoy clavadas a la estimación,
  `calcular-metricas-viaje.ts:394-397`). **Paso 2, PR aparte.** Ver "consistencia transitoria" ↓.
- Canal **app** (`posiciones_movil_conductor`, hoy 0 filas) y el valor de enum **`movil_gps`** →
  `adr-028-ext-movil-gps-propuesta.md`. Este paso usa **`teltonika_gps`**, que ya existe.
- Partición/retención de `telemetria_puntos` → **bloqueada** por el candado (F0-0 §8.2).

## Entradas
- Pings GPS del vehículo en la ventana `pickupAt..deliveredAt` (`telemetria_puntos`: `timestamp_device`,
  `latitud`, `longitud`), ordenados asc — ya se cargan en `calcularCobertura` (`calcular-cobertura-telemetria.ts:139-153`).
- Un **resolver de huecos** `estimarHuecoKm(desde, hasta): Promise<number>` — en prod sobre `computeRoutes`
  (`routes-api.ts`; acepta `"lat,lng"` como origin/destination); inyectable → testeable con mock.
- Distancia estimada origen→destino (fallback para huecos de cola/cabeza sin bracket).

## Salidas
- `metricas_viaje.distancia_km_real` poblado con la distancia híbrida (numeric 10,2).
- `metricas_viaje.coverage_pct` = fracción observada.
- Certificado con `distance_km` = distancia real + leyenda de mezcla medido/estimado.

## Criterios de éxito (verificables)
1. **No subestimación:** para una traza con ≥1 hueco (gap ≥60s), `distancia_km_real > kmObservado`. El
   hueco entra vía resolver; **nunca** se descarta (que daría el sesgo a la baja del backhaul, F0-0 §4).
2. **No colapso a la estimación:** el hueco se estima **por-tramo** entre sus dos pings (resolver
   llamado con esos extremos), **no** con `(1−coverage)×rutaTotal` (que colapsa algebraicamente a la ruta
   estimada y anula el fix, F0-0 §5.1).
3. **Traza continua = distancia observada:** sin huecos, `distancia_km_real == Σ haverside observado` y
   `coverage_pct == 100`; el resolver **no** se llama.
4. **Cobertura consistente:** `coverage_pct == kmObservado / distancia_km_real × 100`, en [0,100].
5. **Falla del sistema externo (Routes caído):** si el resolver de un hueco falla/timeout, el cálculo
   **no** revienta el cierre del trip: cae al fallback declarado (haversine×factor documentado o estimate
   de ruta), marca la procedencia como degradada, y **loguea** — nunca traga el error ni subestima en
   silencio.

## Diseño (para el verde; no se implementa en este commit)
- Función pura-inyectable `calcularDistanciaHibrida(pings, estimarHuecoKm)` en
  `apps/api/src/services/calcular-distancia-real.ts` (sibling de `calcular-cobertura-telemetria.ts`,
  reutiliza su `haversineKm` y `CONTINUITY_GAP_S`). La I/O (Routes) vive en el resolver inyectado → el
  core queda testeable sin red.
- `recalcularNivelPostEntrega` (`calcular-metricas-viaje.ts:411-544`) añade al UPDATE `distanceKmActual`
  + `coveragePct` derivados de la función. Hoy ya calcula cobertura; se extiende para retornar también la
  distancia.
- **Consistencia transitoria (declarada):** entre paso 1 y paso 2 el cert muestra distancia real pero
  emisiones aún modeladas desde la estimación → la leyenda medido/estimado aplica a **distancia**;
  emisiones siguen modeladas hasta el paso 2. No se deja implícito.

## Plan TDD (rojo primero — dominio crítico)
Test `apps/api/src/services/calcular-distancia-real.test.ts` sobre `calcularDistanciaHibrida`, un caso por
criterio 1–5 (comportamiento de negocio, no implementación). Rojo exhibido antes del verde; output del rojo
va en la Evidencia del PR. Incluye el caso de falla externa (criterio 5).

## Orden de release (dependencias, acordado con el PO)
Cada paso desbloquea el siguiente:
1. **Merge PR #597** (auditoría, docs read-only) → main.
2. **Merge este fix** (`fix/distancia-real-hibrida`) → main. **No antes de #597.**
3. **Re-derivación de históricos** (backfill ↑) desde los 260k pings.
4. **Recién ahí** se libera el candado de retención de `telemetria_puntos` (F0-0 §8.2).

## Evidencia (se completa en el PR)
- [ ] Output ROJO de los tests (exhibido: `Cannot find module './calcular-distancia-real.js'`).
- [ ] Output VERDE tras implementar — **el que vale es el CI en node 24** (`gh run watch --exit-status`);
      el verde local en node 26 es solo para iterar.
- [ ] lint + typecheck + build.
- [ ] Coverage ≥80% del código nuevo.
