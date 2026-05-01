import type { Logger } from '@booster-ai/logger';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { tripMetrics, trips, vehicles } from '../db/schema.js';

/**
 * Calcular y persistir métricas ESG estimadas/reales de un viaje.
 *
 * Hooks:
 *   - Pickup confirmado → cálculo `_estimated` (distancia planificada +
 *     perfil del vehículo + factor GLEC v3.0 por tipo combustible).
 *   - Delivered → cálculo `_actual` con telemetría real (CANbus si
 *     disponible, sino dato de driver app, sino fallback modelado).
 *
 * Por ahora es un placeholder que crea/actualiza el registro 1:1 con
 * trips. La lógica real (factores GLEC, cálculo de distancias, etc.)
 * vivirá en `@booster-ai/carbon-calculator` y se inyectará acá una vez
 * que ese package tenga implementación.
 */
export class TripNotFoundError extends Error {
  constructor(public readonly tripId: string) {
    super(`Trip ${tripId} not found`);
    this.name = 'TripNotFoundError';
  }
}

export interface CalcularMetricasResult {
  tripId: string;
  /** True si esta llamada inserta el registro por primera vez. */
  isInitialCalculation: boolean;
}

export async function calcularMetricasEstimadas(opts: {
  db: Db;
  logger: Logger;
  tripId: string;
  /**
   * Vehículo asignado (puede ser null si todavía no se sabe — entonces
   * usamos `por_defecto` como precision_method).
   */
  vehicleId: string | null;
}): Promise<CalcularMetricasResult> {
  const { db, logger, tripId, vehicleId } = opts;

  return await db.transaction(async (tx) => {
    const tripRows = await tx.select().from(trips).where(eq(trips.id, tripId)).limit(1);
    const trip = tripRows[0];
    if (!trip) {
      throw new TripNotFoundError(tripId);
    }

    let vehicleProfile: { fuelType: string | null; baselineConsumption: string | null } = {
      fuelType: null,
      baselineConsumption: null,
    };
    if (vehicleId) {
      const vehs = await tx.select().from(vehicles).where(eq(vehicles.id, vehicleId)).limit(1);
      const veh = vehs[0];
      if (veh) {
        vehicleProfile = {
          fuelType: veh.fuelType,
          baselineConsumption: veh.consumptionLPer100kmBaseline,
        };
      }
    }

    // Placeholder: hasta integrar carbon-calculator, sólo persistimos el
    // registro con metodo_precision='por_defecto' y campos en null. Esto
    // habilita que viajes futuros tengan trip_metrics referenciables sin
    // fallar el FK.
    const existing = await tx
      .select()
      .from(tripMetrics)
      .where(eq(tripMetrics.tripId, tripId))
      .limit(1);
    const isInitialCalculation = existing.length === 0;

    if (isInitialCalculation) {
      await tx.insert(tripMetrics).values({
        tripId,
        precisionMethod: 'por_defecto',
        glecVersion: 'v3.0',
        source: 'modeled',
        calculatedAt: new Date(),
      });
    } else {
      await tx
        .update(tripMetrics)
        .set({
          precisionMethod: 'por_defecto',
          glecVersion: 'v3.0',
          source: 'modeled',
          calculatedAt: new Date(),
          updatedAt: sql`now()`,
        })
        .where(eq(tripMetrics.tripId, tripId));
    }

    logger.info(
      {
        tripId,
        vehicleId,
        fuelType: vehicleProfile.fuelType,
        isInitialCalculation,
      },
      'metricas estimadas calculadas (placeholder)',
    );

    return { tripId, isInitialCalculation };
  });
}
