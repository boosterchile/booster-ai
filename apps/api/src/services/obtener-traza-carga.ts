import type { Logger } from '@booster-ai/logger';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { assignments, tripMetrics, trips, vehicles } from '../db/schema.js';
import { calcularCoberturaPura } from './calcular-cobertura-telemetria.js';
import { cargarTrazaPoints, construirResumen, downsampleTraza } from './obtener-traza-vehiculo.js';

/**
 * Historial de traza de una CARGA (capa 2, versión literal del goal). Dado un
 * assignment, reconstruye la ventana derivada (viaje.recogida_ventana_inicio →
 * asignacion.entregado_en) y devuelve la traza real + la ruta ESPERADA
 * (`eco_route_polyline_encoded`) + un resumen con cobertura (real vs esperada).
 *
 * Reusa el patrón de ventana y las funciones puras de `obtener-traza-vehiculo`
 * + `calcularCoberturaPura`. La distancia esperada sale de
 * `metricas_viaje.distancia_km_estimada` (fuente canónica, misma que usa el
 * cálculo de métricas). Hoy sin datos reales (0 cargas entregadas con
 * telemetría) devuelve traza vacía pero mostrable — scaffold forward-looking.
 */

export interface TrazaCargaResumen {
  distanciaRealKm: number;
  /** `metricas_viaje.distancia_km_estimada`; `null` si no hay métricas. */
  distanciaEsperadaKm: number | null;
  duracionMin: number;
  /** Cobertura real vs esperada [0..100]; `null` sin distancia esperada o < 2 puntos. */
  coberturaPct: number | null;
  litrosConsumidos: number | null;
  kmCan: number | null;
}

export interface TrazaCargaData {
  assignmentId: string;
  tripId: string;
  plate: string;
  /** ISO del inicio de ventana (pickup); `null` si el viaje no tiene ventana. */
  desde: string | null;
  /** ISO del fin de ventana (entregado_en, o `now` si aún en curso). */
  hasta: string;
  delivered: boolean;
  puntos: Array<{ tMs: number; lat: number; lng: number }>;
  puntosTotal: number;
  /** Polyline encoded de la ruta esperada (Routes API), para dibujar el overlay. */
  rutaEsperadaPolyline: string | null;
  resumen: TrazaCargaResumen;
}

export type TrazaCargaResult = { kind: 'not_found' } | { kind: 'ok'; data: TrazaCargaData };

export async function obtenerTrazaCarga(opts: {
  db: Db;
  logger: Logger;
  assignmentId: string;
  empresaId: string;
  maxPuntos: number;
  /** Instante actual (para la ventana de cargas aún no entregadas). */
  now: Date;
}): Promise<TrazaCargaResult> {
  const { db, logger, assignmentId, empresaId, maxPuntos, now } = opts;

  const [row] = await db
    .select({
      vehicleId: assignments.vehicleId,
      plate: vehicles.plate,
      tripId: assignments.tripId,
      pickup: trips.pickupWindowStart,
      delivered: assignments.deliveredAt,
      polyline: assignments.ecoRoutePolylineEncoded,
      distanciaEstimada: tripMetrics.distanceKmEstimated,
    })
    .from(assignments)
    .innerJoin(trips, eq(trips.id, assignments.tripId))
    .innerJoin(vehicles, eq(vehicles.id, assignments.vehicleId))
    .leftJoin(tripMetrics, eq(tripMetrics.tripId, assignments.tripId))
    .where(and(eq(assignments.id, assignmentId), eq(assignments.empresaId, empresaId)))
    .limit(1);

  if (!row) {
    return { kind: 'not_found' };
  }

  const desde = row.pickup;
  const hasta = row.delivered ?? now;
  const distanciaEsperadaKm = row.distanciaEstimada !== null ? Number(row.distanciaEstimada) : null;

  // Sin ventana (pickup null) → traza vacía, pero seguimos exponiendo la ruta
  // esperada + la distancia estimada.
  const puntos = desde
    ? await cargarTrazaPoints({ db, vehicleId: row.vehicleId, desde, hasta })
    : [];

  const base = construirResumen(puntos);
  const coberturaPct =
    distanciaEsperadaKm !== null && distanciaEsperadaKm > 0 && puntos.length >= 2
      ? calcularCoberturaPura(puntos, distanciaEsperadaKm)
      : null;
  const down = downsampleTraza(puntos, maxPuntos);

  logger.info(
    {
      assignmentId,
      vehicleId: row.vehicleId,
      puntosTotal: puntos.length,
      delivered: row.delivered !== null,
      conRutaEsperada: row.polyline !== null,
    },
    'traza de carga calculada',
  );

  return {
    kind: 'ok',
    data: {
      assignmentId,
      tripId: row.tripId,
      plate: row.plate,
      desde: desde ? desde.toISOString() : null,
      hasta: hasta.toISOString(),
      delivered: row.delivered !== null,
      puntos: down.map((p) => ({ tMs: p.tMs, lat: p.lat, lng: p.lng })),
      puntosTotal: puntos.length,
      rutaEsperadaPolyline: row.polyline,
      resumen: {
        distanciaRealKm: base.distanciaKm,
        distanciaEsperadaKm,
        duracionMin: base.duracionMin,
        coberturaPct,
        litrosConsumidos: base.litrosConsumidos,
        kmCan: base.kmCan,
      },
    },
  };
}
