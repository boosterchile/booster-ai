import {
  type ResultadoEmisiones,
  type TipoCombustible,
  calcularEmisionesViaje,
} from '@booster-ai/carbon-calculator';
import type { Logger } from '@booster-ai/logger';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { tripMetrics, trips, vehicles } from '../db/schema.js';
import { estimarDistanciaKm } from './estimar-distancia.js';

/**
 * Calcular y persistir métricas ESG de un viaje, usando el carbon-calculator
 * (GLEC v3.0 + factores SEC Chile 2024).
 *
 * Estrategia de modo (precision_method):
 *   1. Si vehículo asignado tiene `teltonika_imei` Y disponemos de
 *      telemetría real → modo `exacto_canbus`. Por ahora la telemetría
 *      no llega aún (Phase 2), entonces caemos al siguiente paso.
 *   2. Si vehículo tiene perfil energético declarado (tipo_combustible
 *      + consumo_l_por_100km_base) → modo `modelado`.
 *   3. Caso contrario → modo `por_defecto` con tipo_vehiculo como proxy.
 *
 * Hooks de invocación (a wirear desde el orquestador):
 *   - Asignación creada → calcular `_estimadas` con distancia planificada
 *     y carga declarada. Permite mostrar al carrier "tu viaje genera ~X
 *     kg CO2e estimado" antes de aceptar.
 *   - Entrega confirmada → recalcular `_reales` con datos del viaje real
 *     (telemetría si la hay, sino se queda con la estimación).
 *
 * Importante: la distancia hoy viene de `estimarDistanciaKm()` (tabla
 * pre-computada Chile). En Phase 2 reemplazar por Google Maps Routes API
 * para precisión geo real (con tráfico + altimetría).
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
  /** Resultado del cálculo (siempre presente; usa por_defecto como fallback). */
  emisiones: ResultadoEmisiones;
}

/**
 * Calcular métricas estimadas (al asignar viaje, antes de la entrega).
 */
export async function calcularMetricasEstimadas(opts: {
  db: Db;
  logger: Logger;
  tripId: string;
  vehicleId: string | null;
}): Promise<CalcularMetricasResult> {
  const { db, logger, tripId, vehicleId } = opts;

  return await db.transaction(async (tx) => {
    const tripRows = await tx.select().from(trips).where(eq(trips.id, tripId)).limit(1);
    const trip = tripRows[0];
    if (!trip) {
      throw new TripNotFoundError(tripId);
    }

    const cargaKg = trip.cargoWeightKg ?? 0;
    const distanciaKm = estimarDistanciaKm(trip.originRegionCode, trip.destinationRegionCode);

    // Resolver perfil del vehículo. Si no hay vehicleId aún, o no se
    // encuentra, o no tiene perfil completo → modo por_defecto.
    let emisiones: ResultadoEmisiones | null = null;
    if (vehicleId) {
      const vehs = await tx.select().from(vehicles).where(eq(vehicles.id, vehicleId)).limit(1);
      const veh = vehs[0];
      if (veh) {
        const consumoBase = veh.consumptionLPer100kmBaseline
          ? Number(veh.consumptionLPer100kmBaseline)
          : null;

        if (veh.fuelType && consumoBase != null) {
          // Modo modelado — perfil completo declarado.
          emisiones = calcularEmisionesViaje({
            metodo: 'modelado',
            distanciaKm,
            cargaKg,
            vehiculo: {
              combustible: veh.fuelType as TipoCombustible,
              consumoBasePor100km: consumoBase,
              pesoVacioKg: veh.curbWeightKg,
              capacidadKg: veh.capacityKg,
            },
          });
        } else {
          // Modo por_defecto — usamos tipo de vehículo como proxy.
          emisiones = calcularEmisionesViaje({
            metodo: 'por_defecto',
            distanciaKm,
            cargaKg,
            tipoVehiculo: veh.vehicleType,
          });
        }
      }
    }
    if (emisiones == null) {
      // Fallback: por_defecto con camion_mediano (proxy genérico).
      emisiones = calcularEmisionesViaje({
        metodo: 'por_defecto',
        distanciaKm,
        cargaKg,
        tipoVehiculo: 'camion_mediano',
      });
    }

    const existing = await tx
      .select()
      .from(tripMetrics)
      .where(eq(tripMetrics.tripId, tripId))
      .limit(1);
    const isInitialCalculation = existing.length === 0;

    const valuesToWrite = {
      distanceKmEstimated: emisiones.distanciaKm.toString(),
      carbonEmissionsKgco2eEstimated: emisiones.emisionesKgco2eWtw.toString(),
      fuelConsumedLEstimated:
        emisiones.unidadCombustible === 'L' ? emisiones.combustibleConsumido.toString() : null,
      precisionMethod: emisiones.metodoPrecision,
      glecVersion: emisiones.versionGlec,
      emissionFactorUsed: emisiones.factorEmisionUsado.toString(),
      source: 'modelado',
      calculatedAt: new Date(),
    };

    if (isInitialCalculation) {
      await tx.insert(tripMetrics).values({ tripId, ...valuesToWrite });
    } else {
      await tx
        .update(tripMetrics)
        .set({ ...valuesToWrite, updatedAt: sql`now()` })
        .where(eq(tripMetrics.tripId, tripId));
    }

    logger.info(
      {
        tripId,
        vehicleId,
        metodoPrecision: emisiones.metodoPrecision,
        distanciaKm: emisiones.distanciaKm,
        cargaKg,
        emisionesKgco2eWtw: emisiones.emisionesKgco2eWtw,
        intensidadGco2ePorTonKm: emisiones.intensidadGco2ePorTonKm,
        isInitialCalculation,
      },
      'metricas estimadas calculadas',
    );

    return { tripId, isInitialCalculation, emisiones };
  });
}
