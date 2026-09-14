import type { Logger } from '@booster-ai/logger';
import type { Db } from '../db/client.js';
import {
  type PingPoint,
  type VehiculoFuentePosicion,
  fuentePosicionSegmento,
  resolverPosicionesSegmento,
} from './posicion-segmento.js';

export type { PingPoint } from './posicion-segmento.js';

/**
 * Cálculo de cobertura telemétrica de un trip (ADR-028 §5) y de la distancia
 * realmente medida sobre el segmento (T11, plan medicion-huella-segmento).
 *
 * Define qué porcentaje del trip estuvo cubierto por pings GPS continuos de
 * la fuente del vehículo (Teltonika o móvil del conductor, Task 10). Es la
 * métrica clave para downgrade automático del nivel de certificación cuando
 * el dispositivo perdió señal mid-trip.
 *
 * Algoritmo:
 *
 *     km_cubiertos = sumatoria de distancias haversine entre pings
 *                    consecutivos cuyo gap temporal < CONTINUITY_GAP_S
 *
 *     coverage_pct = (km_cubiertos / km_totales_estimados) × 100
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
 * - **`kmCubiertos` ya no se descarta** (T11; hallazgo F0-0). Es la distancia
 *   MEDIDA, independiente del denominador: con `distanciaEstimadaKm = 0` el
 *   porcentaje es 0 pero los km siguen siendo los observados. El cap a 100
 *   aplica solo al porcentaje.
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
 * La lógica del cálculo (haversine + suma) está en `calcularCoberturaPura`
 * (sin I/O); `calcularCobertura` lee los pings por la fuente ruteada del
 * vehículo sobre la ventana real `[pickedUpAt, deliveredAt]`.
 */

/** Gap máximo en segundos entre pings consecutivos para considerarlos
 *  parte del mismo segmento continuo (ADR-028 §5). */
export const CONTINUITY_GAP_S = 60;

/** Radio de la Tierra en km, usado en haversine. WGS84 mean radius. */
const EARTH_RADIUS_KM = 6371;

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

export interface CoberturaSegmento {
  /** coverage_pct ∈ [0, 100]. */
  coveragePct: number;
  /** Distancia MEDIDA: Σ haversine de los tramos continuos (km). Sin cap. */
  kmCubiertos: number;
}

/**
 * Calcula cobertura y distancia medida sobre una lista de pings (función
 * pura, sin I/O).
 *
 * Recibe pings ordenados ascendentemente por tiempo. Suma distancias
 * haversine entre pings consecutivos cuando el gap < CONTINUITY_GAP_S.
 *
 * @param pings ordenados por tMs ascendente
 * @param distanciaEstimadaKm distancia origen→destino (denominador del %)
 */
export function calcularCoberturaPura(
  pings: readonly PingPoint[],
  distanciaEstimadaKm: number,
): CoberturaSegmento {
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

  if (distanciaEstimadaKm <= 0) {
    return { coveragePct: 0, kmCubiertos };
  }
  const pct = (kmCubiertos / distanciaEstimadaKm) * 100;
  return { coveragePct: Math.min(Math.max(pct, 0), 100), kmCubiertos };
}

export interface CoberturaSegmentoResultado extends CoberturaSegmento {
  /** Fuente de la que salieron los pings (ADR-077 §1). */
  fuente: 'teltonika_gps' | 'movil_gps';
  /** Pings con fix dentro de la ventana. */
  pingsValidos: number;
}

/**
 * Lee los pings del vehículo por su fuente (Task 10) sobre el segmento real
 * `[pickedUpAt, deliveredAt]` y calcula cobertura + distancia medida. Si el
 * vehículo no tiene pings o la distancia estimada es 0, devuelve 0/0 sin error.
 */
export async function calcularCobertura(opts: {
  db: Db;
  logger: Logger;
  vehicle: VehiculoFuentePosicion;
  /** Inicio del segmento — `assignments.recogido_en` (recogida real, F1). */
  pickedUpAt: Date;
  /** Fin del segmento — `assignments.entregado_en`. */
  deliveredAt: Date;
  /** Distancia origen→destino esperada en km. */
  distanciaEstimadaKm: number;
}): Promise<CoberturaSegmentoResultado> {
  const { db, logger, vehicle, pickedUpAt, deliveredAt, distanciaEstimadaKm } = opts;
  const fuente = fuentePosicionSegmento(vehicle).fuente;

  if (distanciaEstimadaKm <= 0) {
    logger.debug(
      { vehicleId: vehicle.id, distanciaEstimadaKm },
      'cobertura=0 (distancia estimada <= 0)',
    );
    return { coveragePct: 0, kmCubiertos: 0, fuente, pingsValidos: 0 };
  }

  const validPings = await resolverPosicionesSegmento({
    db,
    vehicle,
    desde: pickedUpAt,
    hasta: deliveredAt,
  });
  const cobertura = calcularCoberturaPura(validPings, distanciaEstimadaKm);

  logger.info(
    {
      vehicleId: vehicle.id,
      fuente,
      pickedUpAt,
      deliveredAt,
      distanciaEstimadaKm,
      pingsValidos: validPings.length,
      coveragePct: cobertura.coveragePct,
      kmCubiertos: cobertura.kmCubiertos,
    },
    'cobertura telemétrica calculada',
  );

  return { ...cobertura, fuente, pingsValidos: validPings.length };
}
