/**
 * Enrutamiento de la fuente de posición de un vehículo para el segmento
 * medido `pickedUpAt → deliveredAt` (Task 10, plan medicion-huella-segmento;
 * ADR-077 §1).
 *
 * Diseño:
 *   - Un vehículo lee de UNA sola fuente, decidida por su dispositivo — sin
 *     merge de streams (spec F2). Mismo criterio de partición que la flota en
 *     vivo (`routes/vehiculos.ts`, D1/D2):
 *       · `teltonika_imei` propio → `telemetria_puntos` por `vehiculo_id`
 *         (índice `idx_telemetria_vehiculo_ts`; reusa `cargarPingsVentana`).
 *       · solo `teltonika_imei_espejo` → `telemetria_puntos` por `imei`: el
 *         stream pertenece a otro vehículo físico (demo/redundancia).
 *       · sin dispositivo → `posiciones_movil_conductor` por `vehiculo_id`
 *         (GPS del móvil del conductor, `POST /assignments/:id/driver-position`).
 *   - `fuentePosicionSegmento` es el clasificador PURO y se exporta aparte:
 *     T11/T12 lo usan para persistir `fuente_dato_ruta` (`teltonika_gps` vs
 *     `movil_gps`, ADR-077 §2) sin re-derivar la regla.
 *   - Salida uniforme `PingPoint[]` (`{ tMs, lat, lng }`) ordenada ascendente
 *     por `timestamp_device` y ya filtrada de filas sin fix (lat/lng null y
 *     null island 0,0 vía `esCoordenadaGpsValida`), igual que el loader de
 *     cobertura: T11 puede alimentar `calcularCoberturaPura` sin adaptar nada.
 *   - Sin filas → `[]`, nunca lanza: decidir la degradación (cobertura baja →
 *     distancia estimada) es de la cobertura/T12, no de este módulo.
 *
 * Supuestos:
 *   - `desde <= hasta`; la ventana es inclusiva en ambos extremos, igual que
 *     `cargarPingsVentana`.
 *   - Coordenadas `numeric(10,7)` llegan como string desde Drizzle y se
 *     convierten con `Number(...)`.
 */

import { and, asc, eq, gte, lte } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { posicionesMovilConductor, telemetryPoints } from '../db/schema.js';
import { type PingPoint, cargarPingsVentana } from './calcular-cobertura-telemetria.js';
import { esCoordenadaGpsValida } from './coordenada-gps.js';

/** Fuente de ruta que alimenta el segmento (valores de `fuente_dato_ruta`, ADR-077 §1). */
export type FuentePosicionSegmento = 'teltonika_gps' | 'movil_gps';

/** Lo mínimo del vehículo que decide la fuente. */
export interface VehiculoFuentePosicion {
  id: string;
  teltonikaImei: string | null;
  teltonikaImeiEspejo: string | null;
}

export type DecisionFuentePosicion =
  | { fuente: 'teltonika_gps'; via: 'vehicle_id' }
  | { fuente: 'teltonika_gps'; via: 'imei'; imei: string }
  | { fuente: 'movil_gps' };

/** Clasificador puro: qué fuente (y por qué clave) lee este vehículo. */
export function fuentePosicionSegmento(vehicle: VehiculoFuentePosicion): DecisionFuentePosicion {
  if (vehicle.teltonikaImei) {
    return { fuente: 'teltonika_gps', via: 'vehicle_id' };
  }
  if (vehicle.teltonikaImeiEspejo) {
    return { fuente: 'teltonika_gps', via: 'imei', imei: vehicle.teltonikaImeiEspejo };
  }
  return { fuente: 'movil_gps' };
}

export interface ResolverPosicionesSegmentoOptions {
  db: Db;
  vehicle: VehiculoFuentePosicion;
  desde: Date;
  hasta: Date;
}

/**
 * Pings del vehículo en `[desde, hasta]` desde su ÚNICA fuente, ascendentes por
 * timestamp y sin filas sin fix. `[]` si no hay datos.
 */
export async function resolverPosicionesSegmento(
  opts: ResolverPosicionesSegmentoOptions,
): Promise<PingPoint[]> {
  const { db, vehicle, desde, hasta } = opts;
  const decision = fuentePosicionSegmento(vehicle);

  if (decision.fuente === 'teltonika_gps' && decision.via === 'vehicle_id') {
    return await cargarPingsVentana({
      db,
      vehicleId: vehicle.id,
      pickupAt: desde,
      deliveredAt: hasta,
    });
  }

  if (decision.fuente === 'teltonika_gps') {
    const rows = await db
      .select({
        ts: telemetryPoints.timestampDevice,
        lat: telemetryPoints.latitude,
        lng: telemetryPoints.longitude,
      })
      .from(telemetryPoints)
      .where(
        and(
          eq(telemetryPoints.imei, decision.imei),
          gte(telemetryPoints.timestampDevice, desde),
          lte(telemetryPoints.timestampDevice, hasta),
        ),
      )
      .orderBy(asc(telemetryPoints.timestampDevice));
    return proyectarPings(rows);
  }

  // rls-allowlist: scoped por vehicle.id del assignment ya autorizado por el caller (segmento pickup→entrega)
  const rows = await db
    .select({
      ts: posicionesMovilConductor.timestampDevice,
      lat: posicionesMovilConductor.latitude,
      lng: posicionesMovilConductor.longitude,
    })
    .from(posicionesMovilConductor)
    .where(
      and(
        eq(posicionesMovilConductor.vehicleId, vehicle.id),
        gte(posicionesMovilConductor.timestampDevice, desde),
        lte(posicionesMovilConductor.timestampDevice, hasta),
      ),
    )
    .orderBy(asc(posicionesMovilConductor.timestampDevice));
  return proyectarPings(rows);
}

/** Misma proyección/filtro que `cargarPingsVentana`: descarta null y null island. */
function proyectarPings(
  rows: ReadonlyArray<{ ts: Date; lat: string | null; lng: string | null }>,
): PingPoint[] {
  const pings: PingPoint[] = [];
  for (const p of rows) {
    if (p.lat === null || p.lng === null) {
      continue;
    }
    const lat = Number(p.lat);
    const lng = Number(p.lng);
    if (!esCoordenadaGpsValida(lat, lng)) {
      continue;
    }
    pings.push({ tMs: p.ts.getTime(), lat, lng });
  }
  return pings;
}
