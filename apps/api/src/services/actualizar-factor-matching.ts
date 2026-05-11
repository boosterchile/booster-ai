import { type TipoCombustible, calcularEmptyBackhaul } from '@booster-ai/carbon-calculator';
import type { Logger } from '@booster-ai/logger';
import { and, asc, eq, gt, lt, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { assignments, tripMetrics, trips, vehicles } from '../db/schema.js';
import { haversineKm } from './calcular-cobertura-telemetria.js';
import { REGION_CENTROIDS_LAT_LNG } from './get-public-tracking.js';

/**
 * Factor de ajuste haversine → distancia por carretera. Misma constante
 * que `get-public-tracking.ts` para coherencia en cálculos geo de Chile
 * (red vial agrega ~30% sobre great-circle).
 */
const ROAD_DISTANCE_FACTOR = 1.3;

/**
 * Threshold de proximidad para considerar matching pleno. Si la
 * distancia entre destino del trip actual y origen del próximo trip
 * es ≤ 10% de la distancia de retorno, asumimos factorMatching=1.
 *
 * Esto evita penalizar gaps mínimos por imprecisión de centroides
 * regionales (Chile usa centroides de capital regional, no exactos).
 */
const PROXIMIDAD_MATCH_PLENO_RATIO = 0.1;

/**
 * ADR-021 §6.4 — recalcular `factor_matching_aplicado` post-entrega del
 * viaje, usando una heurística geo del próximo trip del mismo vehículo.
 *
 * **Heurística v2 (haversine, supersede v1 binaria por región)**:
 *
 *   - Buscar el próximo trip *cargado* del mismo vehículo cuya ventana
 *     de pickup arranca dentro de los **7 días corridos** posteriores a
 *     `deliveredAt` del trip actual.
 *   - Si no hay next trip → `factorMatching = 0` (peor caso GLEC §6.4.2).
 *   - Si hay next trip, calcular:
 *     - `dist_retorno` = haversine(destino_actual, origen_actual) × 1.3
 *     - `dist_gap` = haversine(destino_actual, origen_next) × 1.3
 *   - Si `dist_gap ≤ 10% × dist_retorno` → `factorMatching = 1`
 *     (proximidad suficiente para asumir match pleno; tolera ruido de
 *     centroides regionales).
 *   - Si `dist_gap ≥ dist_retorno` → `factorMatching = 0`
 *     (next trip arranca tan lejos que no "evita" empty backhaul).
 *   - Else: `factorMatching = round(1 − dist_gap / dist_retorno, 2)`
 *     (lineal en proximidad).
 *
 * **Por qué supersede v1 binaria por región**: la heurística binaria
 * trataba igual a un next trip a 5km del destino que a 500km dentro de
 * la misma región (ej. Santiago → Talca y vuelta a Talca → Concepción,
 * que son ambos VII pero geográficamente lejos). v2 corrige usando
 * distancia great-circle real de los centroides de capital regional.
 *
 * **Fallback a binaria por región**: si alguno de los region codes no
 * está en `REGION_CENTROIDS_LAT_LNG` (futuras divisiones administrativas
 * o regiones missing), caemos al comportamiento v1 (1 si same code,
 * sino 0). Backwards-compatible.
 *
 * **GLEC §6.4 compliant**: la regla obliga a *atribuir empty backhaul
 * al loaded leg*; nuestra heurística decide cuánto atribuir. Sigue
 * siendo conservadora (no inventa ahorro, todo cap [0, 1]).
 *
 * **Idempotente**: re-llamar el service con el mismo tripId recalcula
 * con los datos vigentes (útil si después del primer recálculo aparece
 * un trip de retorno).
 *
 * **No-op si**:
 *   - El vehículo no tiene perfil energético (consumo + capacidad)
 *     → `factor_matching_aplicado` queda null.
 *   - No hay métricas previas del trip (calcularMetricasEstimadas
 *     debería haber corrido antes).
 *   - El trip no tiene assignment cerrado.
 */

/**
 * Calcula factorMatching ∈ [0, 1] usando haversine + ROAD_FACTOR
 * sobre los centroides regionales. Función pura, testeable directamente.
 *
 * Retorna `null` si falta algún region code (caller cae al fallback
 * v1 binaria).
 */
export function calcularFactorMatchingGeo(opts: {
  origenCurrentRegionCode: string | null;
  destinoCurrentRegionCode: string | null;
  origenNextRegionCode: string | null;
}): number | null {
  const { origenCurrentRegionCode, destinoCurrentRegionCode, origenNextRegionCode } = opts;
  if (!origenCurrentRegionCode || !destinoCurrentRegionCode || !origenNextRegionCode) {
    return null;
  }
  const origenCurrent = REGION_CENTROIDS_LAT_LNG[origenCurrentRegionCode];
  const destinoCurrent = REGION_CENTROIDS_LAT_LNG[destinoCurrentRegionCode];
  const origenNext = REGION_CENTROIDS_LAT_LNG[origenNextRegionCode];
  if (!origenCurrent || !destinoCurrent || !origenNext) {
    return null;
  }
  const distRetorno =
    haversineKm(destinoCurrent.lat, destinoCurrent.lng, origenCurrent.lat, origenCurrent.lng) *
    ROAD_DISTANCE_FACTOR;
  const distGap =
    haversineKm(destinoCurrent.lat, destinoCurrent.lng, origenNext.lat, origenNext.lng) *
    ROAD_DISTANCE_FACTOR;

  // Same-region perfect overlap o trip intra-regional muy corto: tratamos
  // como match pleno para evitar division por ~0.
  if (distRetorno <= 0.001) {
    return distGap <= 0.001 ? 1 : 0;
  }
  if (distGap <= PROXIMIDAD_MATCH_PLENO_RATIO * distRetorno) {
    return 1;
  }
  if (distGap >= distRetorno) {
    return 0;
  }
  const raw = 1 - distGap / distRetorno;
  // Round a 2 decimales para encajar precisión BD numeric(3,2).
  return Math.round(raw * 100) / 100;
}
export async function actualizarFactorMatchingViaje(opts: {
  db: Db;
  logger: Logger;
  tripId: string;
}): Promise<{
  recomputed: boolean;
  factorMatching?: number;
  ahorroCo2eKgWtw?: number;
}> {
  const { db, logger, tripId } = opts;

  const tripRows = await db
    .select({
      id: trips.id,
      originRegionCode: trips.originRegionCode,
      destinationRegionCode: trips.destinationRegionCode,
      destinationAddressRaw: trips.destinationAddressRaw,
    })
    .from(trips)
    .where(eq(trips.id, tripId))
    .limit(1);
  const trip = tripRows[0];
  if (!trip) {
    logger.warn({ tripId }, 'actualizarFactorMatchingViaje: trip no existe');
    return { recomputed: false };
  }

  const asgRows = await db
    .select({
      vehicleId: assignments.vehicleId,
      deliveredAt: assignments.deliveredAt,
    })
    .from(assignments)
    .where(eq(assignments.tripId, tripId))
    .limit(1);
  const assignment = asgRows[0];
  if (!assignment?.vehicleId || !assignment.deliveredAt) {
    logger.debug(
      { tripId, hasAssignment: !!assignment },
      'actualizarFactorMatchingViaje: skip — sin assignment con vehicle + deliveredAt',
    );
    return { recomputed: false };
  }

  const vehRows = await db
    .select({
      fuelType: vehicles.fuelType,
      consumptionLPer100kmBaseline: vehicles.consumptionLPer100kmBaseline,
      capacityKg: vehicles.capacityKg,
    })
    .from(vehicles)
    .where(eq(vehicles.id, assignment.vehicleId))
    .limit(1);
  const veh = vehRows[0];
  if (!veh?.fuelType || !veh.consumptionLPer100kmBaseline || !veh.capacityKg) {
    logger.debug(
      { tripId, vehicleId: assignment.vehicleId },
      'actualizarFactorMatchingViaje: skip — vehículo sin perfil energético completo',
    );
    return { recomputed: false };
  }

  const metricsRows = await db
    .select({
      distanceKmEstimated: tripMetrics.distanceKmEstimated,
    })
    .from(tripMetrics)
    .where(eq(tripMetrics.tripId, tripId))
    .limit(1);
  const metrics = metricsRows[0];
  if (!metrics?.distanceKmEstimated) {
    logger.warn(
      { tripId },
      'actualizarFactorMatchingViaje: trip sin metricas_viaje (corrió calcularMetricasEstimadas?)',
    );
    return { recomputed: false };
  }

  // Ventana de 7 días post deliveredAt para considerar el próximo trip.
  const ventanaFinDate = new Date(assignment.deliveredAt.getTime() + 7 * 24 * 60 * 60 * 1000);

  // Buscar el próximo trip del mismo vehículo: assignment.vehicleId
  // coincide, pickup_window_start > deliveredAt y dentro de la ventana.
  // Orden por pickup_window_start asc → el más cercano cronológicamente.
  const nextRows = await db
    .select({
      tripId: trips.id,
      originRegionCode: trips.originRegionCode,
    })
    .from(trips)
    .innerJoin(assignments, eq(assignments.tripId, trips.id))
    .where(
      and(
        eq(assignments.vehicleId, assignment.vehicleId),
        ne(trips.id, tripId),
        gt(trips.pickupWindowStart, assignment.deliveredAt),
        lt(trips.pickupWindowStart, ventanaFinDate),
      ),
    )
    .orderBy(asc(trips.pickupWindowStart))
    .limit(1);
  const nextTrip = nextRows[0];

  // Heurística v2 (haversine, ADR-021 §6.4):
  //   - Sin next trip → factorMatching = 0 (peor caso GLEC §6.4.2).
  //   - Con next trip + region codes válidos → factor lineal proximidad.
  //   - Si los centroides no están disponibles → fallback v1 (binaria
  //     por mismo region code).
  let factorMatching = 0;
  if (nextTrip?.originRegionCode) {
    const geoFactor = calcularFactorMatchingGeo({
      origenCurrentRegionCode: trip.originRegionCode,
      destinoCurrentRegionCode: trip.destinationRegionCode,
      origenNextRegionCode: nextTrip.originRegionCode,
    });
    if (geoFactor !== null) {
      factorMatching = geoFactor;
    } else if (
      trip.destinationRegionCode &&
      nextTrip.originRegionCode === trip.destinationRegionCode
    ) {
      // Fallback v1 binaria por region code.
      factorMatching = 1;
    }
  }

  const empty = calcularEmptyBackhaul({
    distanciaRetornoKm: Number(metrics.distanceKmEstimated),
    factorMatching,
    consumoBasePor100km: Number(veh.consumptionLPer100kmBaseline),
    combustible: veh.fuelType as TipoCombustible,
    capacidadKg: veh.capacityKg,
  });

  await db
    .update(tripMetrics)
    .set({
      factorMatchingAplicado: factorMatching.toFixed(2),
      emisionesEmptyBackhaulKgco2eWtw: empty.emisionesKgco2eWtw.toString(),
      ahorroCo2eVsSinMatchingKgco2e: empty.ahorroVsSinMatchingKgco2e.toString(),
      updatedAt: sql`now()`,
    })
    .where(eq(tripMetrics.tripId, tripId));

  logger.info(
    {
      tripId,
      vehicleId: assignment.vehicleId,
      nextTripId: nextTrip?.tripId ?? null,
      factorMatching,
      ahorroCo2eKgWtw: empty.ahorroVsSinMatchingKgco2e,
    },
    'factor matching actualizado post-entrega',
  );

  return {
    recomputed: true,
    factorMatching,
    ahorroCo2eKgWtw: empty.ahorroVsSinMatchingKgco2e,
  };
}
