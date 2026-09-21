/**
 * Última posición VIVA de un viaje para tracking (público y generador de
 * carga). Spec: `.specs/tracking-live-unificado/`.
 *
 * **Live ≠ certificación.** `posicion-segmento.ts` (ADR-077 §1) enruta la
 * fuente para la HUELLA post-entrega: una sola fuente por vehículo, decidida
 * por su dispositivo. Esto es otra lectura: dónde está la carga AHORA, decidida
 * por frescura. No toca `fuente_dato_ruta`, cobertura ni certificado.
 *
 * Regla de fuente:
 *   1. Estado del viaje fuera de `asignado | en_proceso` → nada, y sin
 *      consultar la BD. Allowlist fail-closed: terminado el viaje el vehículo
 *      puede estar en otra carga (`.specs/tracking-privacy-position-ttl/`).
 *   2. Hay ping Teltonika del vehículo en la ventana fresca → `teltonika`. El
 *      móvil ni se consulta.
 *   3. Si no: pings del móvil del conductor en la misma ventana y de ESTA
 *      asignación → `mobile`. Se acota por `asignacion_id` (además de
 *      `vehiculo_id`, que usa el índice) para no exponer posiciones que el
 *      mismo vehículo reportó para otro viaje.
 *   4. Ninguno → `source: null`, `pings: []`.
 *
 * Sin merge de streams: los pings devueltos (posición + velocidad promedio +
 * ETA del caller) salen todos de la fuente elegida. No se inventan puntos.
 *
 * Supuestos:
 *   - Teltonika se lee por `vehiculo_id`, como ya hacía el tracking público;
 *     un vehículo solo con `teltonika_imei_espejo` cae al móvil.
 *   - `numeric` llega como string desde Drizzle y se convierte con `Number`.
 *   - Dos pings con el mismo `timestamp_device` se desempatan por `id` DESC.
 *     La migración 0025 no pone UNIQUE en el timestamp del móvil y el índice
 *     `(vehiculo_id, timestamp_device)` no garantiza cuál fila gana el empate:
 *     sin `id`, un insert más nuevo con el mismo reloj GPS puede perder y el
 *     tracking se queda en la primera coordenada.
 */

import { and, desc, eq, gte } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { posicionesMovilConductor, telemetryPoints } from '../db/schema.js';
import { coordenadaGpsValidaSql, esCoordenadaGpsValida } from './coordenada-gps.js';

/** Ventana de «posición fresca». Pings más viejos no se exponen en vivo. */
export const POSITION_FRESH_MINUTES = 30;

/**
 * Estados de fulfillment activo donde la posición viva es legítima. Espeja
 * `ACTIVE_TRIP_STATUSES` del front (`use-public-tracking.ts`).
 */
export const POSITION_VISIBLE_STATUSES: ReadonlySet<string> = new Set(['asignado', 'en_proceso']);

/** Cap defensivo por fuente: 200 pings cubre ~30 min a 1 Hz. */
const MAX_PINGS = 200;

export type LivePositionSource = 'teltonika' | 'mobile';

export interface LivePing {
  timestamp: Date;
  latitude: number;
  longitude: number;
  speedKmh: number | null;
  angleDeg: number | null;
}

export interface LivePosition {
  /** Fuente de TODOS los `pings`. `null` si no hay posición fresca. */
  source: LivePositionSource | null;
  /** Pings frescos de la fuente elegida, DESC (el primero es la última posición). */
  pings: LivePing[];
}

const SIN_POSICION: LivePosition = { source: null, pings: [] };

export async function resolverPosicionEnVivo(opts: {
  db: Db;
  assignmentId: string;
  vehicleId: string;
  tripStatus: string;
  nowMs: number;
}): Promise<LivePosition> {
  const { db, assignmentId, vehicleId, tripStatus, nowMs } = opts;

  if (!POSITION_VISIBLE_STATUSES.has(tripStatus)) {
    return SIN_POSICION;
  }

  const cutoff = new Date(nowMs - POSITION_FRESH_MINUTES * 60_000);

  const teltonika = proyectar(
    await db
      .select({
        timestamp: telemetryPoints.timestampDevice,
        latitude: telemetryPoints.latitude,
        longitude: telemetryPoints.longitude,
        speedKmh: telemetryPoints.speedKmh,
        angleDeg: telemetryPoints.angleDeg,
      })
      .from(telemetryPoints)
      .where(
        and(
          eq(telemetryPoints.vehicleId, vehicleId),
          // Descarta null + «null island» (0,0, GPS sin fix). Ver `coordenada-gps.ts`.
          coordenadaGpsValidaSql(telemetryPoints.latitude, telemetryPoints.longitude),
          gte(telemetryPoints.timestampDevice, cutoff),
        ),
      )
      .orderBy(desc(telemetryPoints.timestampDevice), desc(telemetryPoints.id))
      .limit(MAX_PINGS),
  );
  if (teltonika.length > 0) {
    return { source: 'teltonika', pings: teltonika };
  }

  const mobile = proyectar(
    await db
      .select({
        timestamp: posicionesMovilConductor.timestampDevice,
        latitude: posicionesMovilConductor.latitude,
        longitude: posicionesMovilConductor.longitude,
        speedKmh: posicionesMovilConductor.speedKmh,
        angleDeg: posicionesMovilConductor.headingDeg,
      })
      // rls-allowlist: scoped por asignacion_id + vehiculo_id del assignment ya autorizado por el caller (token público o generador dueño del viaje)
      .from(posicionesMovilConductor)
      .where(
        and(
          eq(posicionesMovilConductor.vehicleId, vehicleId),
          eq(posicionesMovilConductor.assignmentId, assignmentId),
          coordenadaGpsValidaSql(
            posicionesMovilConductor.latitude,
            posicionesMovilConductor.longitude,
          ),
          gte(posicionesMovilConductor.timestampDevice, cutoff),
        ),
      )
      .orderBy(desc(posicionesMovilConductor.timestampDevice), desc(posicionesMovilConductor.id))
      .limit(MAX_PINGS),
  );
  if (mobile.length > 0) {
    return { source: 'mobile', pings: mobile };
  }

  return SIN_POSICION;
}

/**
 * Proyección única de ambas fuentes: `numeric` → number y descarte de filas sin
 * fix. El WHERE ya filtra en la BD; esto es la red por si una fila se cuela
 * (una fuente sin ningún fix válido NO cuenta como fresca).
 */
function proyectar(
  rows: ReadonlyArray<{
    timestamp: Date;
    latitude: string | null;
    longitude: string | null;
    speedKmh: number | string | null;
    angleDeg: number | null;
  }>,
): LivePing[] {
  const pings: LivePing[] = [];
  for (const r of rows) {
    if (r.latitude === null || r.longitude === null) {
      continue;
    }
    const latitude = Number(r.latitude);
    const longitude = Number(r.longitude);
    if (!esCoordenadaGpsValida(latitude, longitude)) {
      continue;
    }
    const speed = r.speedKmh === null ? null : Number(r.speedKmh);
    pings.push({
      timestamp: r.timestamp,
      latitude,
      longitude,
      speedKmh: speed !== null && Number.isFinite(speed) ? speed : null,
      angleDeg: r.angleDeg,
    });
  }
  return pings;
}
