# Historial de vehículo — link de entrada, filtros datetime y duración de movimiento

**Slug:** `historial-duracion-movimiento` · **Rama:** `feat/historial-duracion-movimiento`
**Base:** `origin/main` (944d9e1b) · **Supersede:** nada. Extiende `.specs/vehiculo-traza-historial/` (#615).

## Problema

`/app/vehiculos/:id/historial` (capa 2, #615) funciona y dibuja la traza real, pero:

1. **No hay puerta de entrada.** Solo se llega escribiendo la URL a mano. El detalle
   del vehículo (`DispositivoSection`) tiene "Ver en vivo" (`/live`) pero ningún link a
   `/historial`.
2. **Filtro solo por día.** Los inputs Desde/Hasta son `type="date"`; el frontend appendea
   `T00:00:00Z`/`T23:59:59Z`. No se puede aislar un tramo del día. (El endpoint YA acepta y
   respeta la hora: `z.string().datetime({ offset:true })` + `BETWEEN` sobre `timestamp_device`
   timestamptz — el límite es puramente del frontend.)
3. **Duración = span, no movimiento.** `construirResumen` calcula
   `duracionMin = (ultimo.tMs − primero.tMs)/60_000` — el lapso de la ventana, no el tiempo de
   viaje. Con un rango de 7 días muestra "172 h" (≈ los 7 días), sin significado.

## Alcance

Entradas: `apps/api/src/services/obtener-traza-vehiculo.ts` (funciones puras + query),
`apps/web/src/routes/vehiculo-historial.tsx` (UI de la traza),
`apps/web/src/routes/vehiculos.tsx` (`DispositivoSection`, link de entrada). El path de CARGA
(`obtener-traza-carga.ts`) reusa `cargarTrazaPoints`/`construirResumen` → hereda la duración de
movimiento sin cambios propios.

Fuera de alcance: distancia/combustible/km-CAN (ya corren server-side sobre puntos crudos del
rango; solo se verifica que sigan así), esquema BD, deps, ruta esperada, capa 3.

## Criterios de éxito

### 1. Link "Recorrido"
`DispositivoSection` muestra un link a `/app/vehiculos/$id/historial` junto a "Ver en vivo",
gateado por `currentImei` (igual que "Ver en vivo": sin device no hay telemetría que mostrar).

### 2. Filtros datetime
Inputs `type="datetime-local"` (fecha + hora). El valor local se interpreta en la zona horaria
del navegador (operador en Chile → hora Santiago, DST vía SO) y se convierte a ISO UTC con
`new Date(local).toISOString()` para la query. Default: últimos 7 días con hora. El endpoint ya
respeta la hora → la query filtra a nivel minuto.

### 3. Duración de movimiento (el corazón)
`construirResumen.duracionMin` pasa de span a **tiempo real de movimiento**: suma de los
intervalos `Δt` entre puntos crudos consecutivos, contando `Δt` solo cuando:

- **`0 < Δt < MAX_GAP_MOVIMIENTO_MS`** — descarta huecos sin pings (device apagado/dormido). Un
  hueco de minutos-horas no es tiempo de viaje aunque el ping de despertar traiga velocidad>0.
- **`max(v_prev, v_curr) ≥ VELOCIDAD_MOVIMIENTO_KMH`** — descarta paradas (velocidad ≈ 0
  sostenida). Se usa `max` de los extremos para que los segmentos de aceleración/frenado
  (entrada y salida de una parada) sí cuenten, y solo el interior parado (ambos extremos ≈ 0) se
  excluya.

**Constantes y justificación:**
- `VELOCIDAD_MOVIMIENTO_KMH = 3`. El jitter GPS estacionado suele ser < 3 km/h; marcha real ≥ 3.
- `MAX_GAP_MOVIMIENTO_MS = 5 min`. **No** se reusa `CONTINUITY_GAP_S = 60` (ADR-028 §5, cobertura)
  porque las tolerancias son opuestas: la cobertura quiere el gap *tight* para NO sobre-contar
  distancia (una recta larga falsa); la duración de movimiento quiere el gap *loose* para NO
  sub-contar tiempo de marcha con cadencia dispersa, sin tragarse un hueco de device apagado.
  La cadencia FMC150 en marcha es ~30 s (con jitter/túneles hasta ~1-2 min); un device dormido
  deja huecos de ≥ varios minutos. 5 min separa ambos casos de forma conservadora (undercount
  antes que overcount).
- **Velocidad `null`** (sin fix GPS) → se trata como 0 (no-movimiento): conservador. En datos
  reales los puntos con lat/lng válidos (los únicos que sobreviven a `cargarTrazaPoints`) traen
  velocidad; el `null` solo afecta puntos degenerados.

`TrazaPoint` gana `speedKmh: number | null`; `cargarTrazaPoints` selecciona
`telemetryPoints.speedKmh`. La distancia sigue siendo la suma haversine sobre todos los puntos
del rango (no cambia).

### 4. Agregados sobre el rango filtrado
Sin cambios: `construirResumen`/`distanciaTotalKm`/Δ-CAN ya operan sobre `puntos` crudos de la
ventana `[desde,hasta]`, no sobre la traza downsampleada (que es solo para dibujar).

## Tests (TDD, dominio telemetría → rojo exhibido en la duración)

Puros (`obtener-traza-vehiculo.test.ts`):
- rango que aísla un tramo → duración de movimiento correcta sobre ese subconjunto.
- parada larga en el medio (velocidad 0 sostenida) → duración < span.
- hueco sin pings (Δt > MAX_GAP) con extremos en movimiento → el hueco NO cuenta.
- todo en movimiento sin huecos → duración ≈ span.
- vacío / 1 punto → duración 0, sin romper.

Endpoint (`vehiculos.test.ts`): rows con `speed_kmh` → `duracion_min` refleja movimiento.
Frontend (`vehiculo-historial.test.tsx`): inputs `datetime-local`; cambiar la hora → la query
lleva la hora (round-trip `new Date`). Link (`vehiculos.test.tsx`): "Recorrido" con/sin IMEI.

Evidencia: rojo de la duración, luego verde; suite api+web, typecheck, biome.
