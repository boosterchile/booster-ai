import { type TipoCombustible, calcularEmptyBackhaul } from '@booster-ai/carbon-calculator';
import type { Logger } from '@booster-ai/logger';
import { and, asc, eq, gt, lt, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { assignments, tripMetrics, trips, vehicles } from '../db/schema.js';

/**
 * ADR-021 §6.4 — recalcular `factor_matching_aplicado` post-entrega del
 * viaje, usando una heurística geo del próximo trip del mismo vehículo.
 *
 * **Heurística v1 (honest-default)**:
 *
 *   - Buscar el próximo trip *cargado* del mismo vehículo cuya ventana
 *     de pickup arranca dentro de los **7 días corridos** posteriores a
 *     `deliveredAt` del trip actual.
 *   - Si **el origen del next trip está en la misma región chilena** que
 *     el destino del trip actual → `factorMatching = 1` (matching pleno).
 *   - Si no hay next trip en la ventana o arranca lejos →
 *     `factorMatching = 0` (peor caso, vuelve vacío).
 *
 * Esto NO mide kilómetros exactos del retorno cargado — es una
 * aproximación binaria conservadora. Sigue siendo GLEC §6.4 compliant
 * (la regla obliga a *atribuir empty backhaul al loaded leg*; nuestra
 * heurística decide cuánto atribuir).
 *
 * Una versión futura (out of scope acá) puede:
 *   - Pedir Routes API el km loaded vs km total del retorno.
 *   - Considerar trips parciales (un trip que arranca a 50km del
 *     destino actual → factorMatching = (km_total − 50) / km_total).
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

  // Heurística: matching pleno si la región del próximo origen == región
  // del destino actual. Si no hay next trip → factorMatching = 0.
  let factorMatching = 0;
  if (
    nextTrip?.originRegionCode &&
    trip.destinationRegionCode &&
    nextTrip.originRegionCode === trip.destinationRegionCode
  ) {
    factorMatching = 1;
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
