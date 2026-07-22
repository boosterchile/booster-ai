# Spec — Historial de traza del vehículo (capa 2, reframe)

## Contexto y reframe

El goal original pedía "historial de una CARGA" (traza real + ruta esperada). El **discovery
(read-only) lo bloqueó**: en prod hay **0 cargas entregadas**, la única asignación (AT9155) no tiene
telemetría en su ventana ni polyline, y los vehículos con telemetría (incl. el único con CAN,
PLFL57) **no tienen cargas**. La relación carga↔telemetría da vacío para toda entidad de hoy.

**Decisión del PO (2026-07-22): reframe a historial del VEHÍCULO** — por `vehiculoId` + rango de
fechas, que sí tiene datos reales hoy y sirve el valor declarado ("movimientos del vehículo, vale
por sí solo"). Se descarta la "ruta esperada" (es per-carga, no aplica a un vehículo).

## Datos verificados (prod, read-only)

- PLFL57: 9.497 puntos (2026-07-14→22), **9.235 con CAN**. Día 07-20 = 42 pts.
- CAN ID 83 (fuel consumed, acum.): Δ rango = 3.915 → **×0.1 L ⇒ ~391 L**.
- CAN ID 87 (CAN mileage, acum.): Δ rango = 993.785 → **metros ⇒ ~994 km**. (~39 L/100km, coherente).
- Volumen: rango amplio supera 1.000 puntos → **downsampling con cap** (Douglas-Peucker preserva forma).

## Entradas

`GET /vehiculos/:id/traza?desde=<ISO>&hasta=<ISO>[&maxPuntos=<n>]`
- `desde`/`hasta`: instantes ISO-8601 (Zod). `hasta` > `desde`. Rango máx defensivo (p.ej. 31 días).
- `maxPuntos`: opcional, default 800, cap duro 2000 (protege el browser).

## Salidas (DTO)

```
{
  vehicle_id, plate,
  desde, hasta,
  puntos: [{ t: ISO, lat: number, lng: number }],   // downsampleada
  puntos_total: number,        // crudos en la ventana (transparencia del downsampling)
  puntos_devueltos: number,
  resumen: {
    distancia_km: number,      // suma haversine sobre puntos CRUDOS (no el downsample)
    duracion_min: number,      // último - primer ts
    litros_consumidos: number | null,   // Δ ID 83 ×0.1  (null si <2 puntos con CAN)
    km_can: number | null,              // Δ ID 87 /1000 (null si <2 puntos con CAN)
  }
}
```
Sin telemetría en la ventana → `puntos: []`, `resumen` con distancia/duración 0 y CAN null. No rompe.

## Criterios de éxito

1. **Downsampling puro** (Douglas-Peucker): respeta `maxPuntos` (nunca devuelve más) y **preserva la
   forma** (conserva extremos + vértices de mayor desviación). Tests de propiedad.
2. **Resumen correcto**: distancia = Σ haversine sobre crudos; CAN litros/km del Δ de 83/87 entre
   primer y último punto con CAN; null-safe sin CAN (mismo criterio que #612).
3. **Endpoint**: Zod en query; con-telemetría → traza no vacía + resumen; sin-telemetría → vacío, no
   rompe; span OTel + métrica de negocio.
4. **Vista** `/app/vehiculos/:id/historial` (hermana de `/live`): dibuja la traza real sobre el mapa
   (reusa `@vis.gl/react-google-maps` + `boundsOf` de `lib/polyline.ts`) + card de resumen. Selector
   de rango.
5. Suite verde (typecheck/test/build/biome); Trivy limpio (sin deps nuevas de riesgo).

## Arquitectura / reuso

- Capa 0: extender `packages/shared-schemas/src/avl-ids/can-lvcan.ts` con ID 83 (×0.1 L) y 87 (m) +
  `interpretCanLvcan`. Aditivo sobre lo de #612.
- Puro: `downsampleDouglasPeucker` + `distanciaTotalKm` como funciones puras exportadas del service
  (patrón `calcularCoberturaPura`), con unit tests. Reusa `haversineKm` de `calcular-cobertura-telemetria`.
- Service `obtener-traza-vehiculo.ts`: query ventana por `vehiculo_id` + `timestamp_device BETWEEN
  desde AND hasta` (índice `idx_telemetria_vehiculo_ts`), select ts/lat/lng/io_data.
- Front: `TrazaMapPreview` (espejo de `EcoRouteMapPreview`, puntos directos) + `vehiculo-historial.tsx`.

## Fuera de alcance

Ruta esperada (per-carga), análisis de desviaciones (capa 3), historial por carga (bloqueado por
datos — retomar cuando exista una carga entregada con telemetría).
