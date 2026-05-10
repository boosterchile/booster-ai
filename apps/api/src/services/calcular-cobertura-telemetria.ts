import type { Logger } from '@booster-ai/logger';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { telemetryPoints } from '../db/schema.js';

/**
 * Cálculo de cobertura telemétrica de un trip (ADR-028 §5).
 *
 * Define qué porcentaje del trip estuvo cubierto por pings GPS continuos
 * del Teltonika. Es la métrica clave para downgrade automático del nivel
 * de certificación cuando el dispositivo perdió señal mid-trip.
 *
 * Algoritmo:
 *
 *     coverage_pct =
 *       (km_cubiertos_por_pings_continuos / km_totales_estimados) × 100
 *
 *     km_cubiertos = sumatoria de distancias haversine entre pings
 *                    consecutivos cuyo gap temporal < CONTINUITY_GAP_S
 *
 *     km_totales_estimados = distancia origen→destino (Maps Routes API
 *                            o tabla pre-computada Chile)
 *
 * Decisiones de diseño:
 *
 * - **Threshold de continuidad = 60 segundos** entre pings consecutivos.
 *   Por debajo del gap, el segmento se considera cubierto. Por encima,
 *   el polyline real en ese tramo es desconocido y NO se cuenta como
 *   cobertura. 60s es conservador: el FMC150 reporta cada ~30s en
 *   tracking activo, así que un gap > 60s indica pérdida real de señal.
 *
 * - **Si no hay pings → coverage = 0**. El servicio devuelve `0`, no
 *   `null`, para que la matriz §2 caiga limpia a secundario sin caso
 *   especial.
 *
 * - **Si distanciaEstimadaKm = 0** (caso defensivo, no debería ocurrir)
 *   → coverage = 0. Evita división por cero.
 *
 * - **Cap a 100**. Si por errores de GPS los pings reportan distancias
 *   superiores a la estimación (ej. ruta más larga que la sugerida),
 *   capeamos a 100. Reportar > 100% sería contraintuitivo en el cert.
 *
 * Función con I/O: hace una query a `telemetria_puntos`. Pero la lógica
 * del cálculo (haversine + suma) está extraída en `calcularCoberturaPura`
 * para test independiente del DB.
 */

/** Gap máximo en segundos entre pings consecutivos para considerarlos
 *  parte del mismo segmento continuo (ADR-028 §5). */
export const CONTINUITY_GAP_S = 60;

/** Radio de la Tierra en km, usado en haversine. WGS84 mean radius. */
const EARTH_RADIUS_KM = 6371;

interface PingPoint {
  /** Timestamp del ping en epoch ms. */
  tMs: number;
  lat: number;
  lng: number;
}

/**
 * Distancia great-circle entre dos puntos GPS via fórmula haversine.
 * Output en km. Suficientemente precisa (<0.5% error) para distancias
 * típicas de un trip dentro de Chile (decenas a miles de km).
 */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

/**
 * Calcula cobertura sobre una lista de pings (función pura, sin I/O).
 *
 * Recibe pings ordenados ascendentemente por tiempo. Suma distancias
 * haversine entre pings consecutivos cuando el gap < CONTINUITY_GAP_S.
 *
 * @param pings ordenados por tMs ascendente
 * @param distanciaEstimadaKm distancia origen→destino (denominador)
 * @returns coverage_pct ∈ [0, 100]
 */
export function calcularCoberturaPura(
  pings: readonly PingPoint[],
  distanciaEstimadaKm: number,
): number {
  if (distanciaEstimadaKm <= 0 || pings.length < 2) {
    return 0;
  }

  let kmCubiertos = 0;
  for (let i = 1; i < pings.length; i++) {
    const prev = pings[i - 1];
    const curr = pings[i];
    if (!prev || !curr) {
      continue;
    }
    const gapS = (curr.tMs - prev.tMs) / 1000;
    if (gapS < CONTINUITY_GAP_S) {
      kmCubiertos += haversineKm(prev.lat, prev.lng, curr.lat, curr.lng);
    }
  }

  const pct = (kmCubiertos / distanciaEstimadaKm) * 100;
  return Math.min(Math.max(pct, 0), 100);
}

/**
 * Carga los pings del vehículo en la ventana del trip y calcula la
 * cobertura. Si el vehículo no tiene pings o la distancia estimada es 0,
 * devuelve 0 sin error.
 */
export async function calcularCobertura(opts: {
  db: Db;
  logger: Logger;
  vehicleId: string;
  /** Inicio del trip — usualmente trips.pickup_window_start. */
  pickupAt: Date;
  /** Fin del trip — usualmente assignments.delivered_at. */
  deliveredAt: Date;
  /** Distancia origen→destino esperada en km. */
  distanciaEstimadaKm: number;
}): Promise<number> {
  const { db, logger, vehicleId, pickupAt, deliveredAt, distanciaEstimadaKm } = opts;

  if (distanciaEstimadaKm <= 0) {
    logger.debug({ vehicleId, distanciaEstimadaKm }, 'cobertura=0 (distancia estimada <= 0)');
    return 0;
  }

  // Solo necesitamos lat/lng/timestampDevice para el cálculo. Ordenado
  // ascendente por timestamp para que `calcularCoberturaPura` opere
  // sobre la secuencia natural de pings.
  const pings = await db
    .select({
      ts: telemetryPoints.timestampDevice,
      lat: telemetryPoints.latitude,
      lng: telemetryPoints.longitude,
    })
    .from(telemetryPoints)
    .where(
      and(
        eq(telemetryPoints.vehicleId, vehicleId),
        gte(telemetryPoints.timestampDevice, pickupAt),
        lte(telemetryPoints.timestampDevice, deliveredAt),
      ),
    )
    .orderBy(asc(telemetryPoints.timestampDevice));

  // Filtramos pings sin lat/lng (defensa contra rows malformados —
  // schema permite null en latitud/longitud para records sin GPS fix).
  const validPings: PingPoint[] = [];
  for (const p of pings) {
    if (p.lat === null || p.lng === null) {
      continue;
    }
    validPings.push({
      tMs: p.ts.getTime(),
      lat: Number(p.lat),
      lng: Number(p.lng),
    });
  }

  const coverage = calcularCoberturaPura(validPings, distanciaEstimadaKm);

  logger.info(
    {
      vehicleId,
      pickupAt,
      deliveredAt,
      distanciaEstimadaKm,
      pingsTotal: pings.length,
      pingsValidos: validPings.length,
      coveragePct: coverage,
    },
    'cobertura telemétrica calculada',
  );

  return coverage;
}
