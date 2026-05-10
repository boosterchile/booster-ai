import {
  type ResultadoEmisiones,
  type RouteDataSource,
  type TipoCombustible,
  calcularEmisionesViaje,
  calcularFactorIncertidumbre,
  derivarNivelCertificacion,
} from '@booster-ai/carbon-calculator';
import type { Logger } from '@booster-ai/logger';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { assignments, tripMetrics, trips, vehicles } from '../db/schema.js';
import { calcularCobertura } from './calcular-cobertura-telemetria.js';
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

    // ADR-028 — derivar fuente de datos y nivel de certificación.
    //
    // En esta fase pre-entrega no hay telemetría real disponible — la
    // distancia viene de `estimarDistanciaKm` (tabla Chile) y se trata
    // conceptualmente como ruta modelada Maps-style. Si en Phase 1 se
    // reemplaza por Routes API, la fuente sigue siendo `maps_directions`.
    //
    // `coveragePct = 0` porque no hay pings GPS aún; cuando se cierre el
    // trip y telemetry-processor calcule la cobertura real, este servicio
    // se llamará de nuevo (post-entrega) y los valores se actualizarán.
    const routeDataSource: RouteDataSource = 'maps_directions';
    const coveragePct = 0;
    const certificationLevel = derivarNivelCertificacion({
      precisionMethod: emisiones.metodoPrecision,
      routeDataSource,
      coveragePct,
    });
    const uncertaintyFactor = calcularFactorIncertidumbre({
      nivelCertificacion: certificationLevel,
      coveragePct,
      // En modo estimado pre-entrega no comparamos contra Routes API, así
      // que asumimos que el tipo declarado matchea (no penalizamos sin
      // evidencia). La verificación real ocurre post-entrega.
      vehicleTypeMatchesRoutesApi: true,
    });

    const valuesToWrite = {
      distanceKmEstimated: emisiones.distanciaKm.toString(),
      carbonEmissionsKgco2eEstimated: emisiones.emisionesKgco2eWtw.toString(),
      fuelConsumedLEstimated:
        emisiones.unidadCombustible === 'L' ? emisiones.combustibleConsumido.toString() : null,
      precisionMethod: emisiones.metodoPrecision,
      glecVersion: emisiones.versionGlec,
      emissionFactorUsed: emisiones.factorEmisionUsado.toString(),
      source: 'modelado',
      // ADR-028 — campos nuevos del modelo dual.
      routeDataSource,
      coveragePct: coveragePct.toString(),
      certificationLevel,
      uncertaintyFactor: uncertaintyFactor.toString(),
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

/**
 * Re-deriva el nivel de certificación post-entrega usando la cobertura
 * telemétrica real (ADR-028 §5).
 *
 * Disparo: al confirmar entrega, ANTES de emitir el certificado. Tiene
 * que correr en este orden porque emitirCertificadoViaje lee
 * `certification_level` y `uncertainty_factor` del row de
 * `metricas_viaje` para elegir el template del PDF (primario vs
 * secundario) y el ± impreso.
 *
 * Lógica:
 *   1. Cargar trip + assignment + métricas existentes.
 *   2. Si el vehículo NO tiene Teltonika asociado, no hay forma de
 *      mejorar la cobertura — skip silencioso (el cert sale con los
 *      valores estimados pre-entrega: maps_directions + 0%).
 *   3. Si el vehículo tiene Teltonika, calcular cobertura entre
 *      pickupAt y deliveredAt; promover routeDataSource a teltonika_gps.
 *   4. Re-derivar nivel + uncertainty con los nuevos valores.
 *   5. UPDATE selectivo de los 4 campos (no toca emisiones, factor, etc.
 *      — esos se mantienen del cálculo estimado, salvo que en una
 *      revisión futura agreguemos modo `exacto_canbus` con consumo real
 *      del CAN bus).
 *
 * Idempotente: si la cobertura nueva da el mismo nivel, el UPDATE es
 * no-op (drizzle igual hace el round-trip — opt: chequeo de igualdad
 * antes de update si esto se vuelve hot path).
 */
export async function recalcularNivelPostEntrega(opts: {
  db: Db;
  logger: Logger;
  tripId: string;
}): Promise<{
  recomputed: boolean;
  /** Nivel resultante (puede ser igual al previo). */
  certificationLevel?: 'primario_verificable' | 'secundario_modeled' | 'secundario_default';
  /** Cobertura calculada (0..100). */
  coveragePct?: number;
}> {
  const { db, logger, tripId } = opts;

  const tripRows = await db.select().from(trips).where(eq(trips.id, tripId)).limit(1);
  const trip = tripRows[0];
  if (!trip) {
    throw new TripNotFoundError(tripId);
  }

  const metricsRows = await db
    .select()
    .from(tripMetrics)
    .where(eq(tripMetrics.tripId, tripId))
    .limit(1);
  const existing = metricsRows[0];
  if (!existing) {
    // No hay métricas previas — no hay nada que recalcular. Esto
    // normalmente no debería ocurrir en producción (calcularMetricasEstimadas
    // corre al asignar), pero defensivo: log + skip.
    logger.warn({ tripId }, 'recalcularNivelPostEntrega: trip sin metricas_viaje');
    return { recomputed: false };
  }

  // Necesitamos vehicleId + deliveredAt del assignment. Si no hay
  // assignment cerrado, no se debería estar llamando esta función todavía.
  const assignmentRows = await db
    .select({
      vehicleId: assignments.vehicleId,
      deliveredAt: assignments.deliveredAt,
    })
    .from(assignments)
    .where(eq(assignments.tripId, tripId))
    .limit(1);
  const assignment = assignmentRows[0];

  if (!assignment?.vehicleId || !assignment.deliveredAt) {
    logger.info(
      { tripId, hasAssignment: !!assignment, hasVehicle: !!assignment?.vehicleId },
      'recalcularNivelPostEntrega: skip (sin assignment con vehicle + deliveredAt)',
    );
    return { recomputed: false };
  }

  // Si el vehículo no tiene Teltonika, no hay telemetría — el nivel se
  // queda como secundario_modeled con maps_directions y coverage 0.
  // Skip silencioso para no escribir un UPDATE no-op.
  const vehRows = await db
    .select({ teltonikaImei: vehicles.teltonikaImei })
    .from(vehicles)
    .where(eq(vehicles.id, assignment.vehicleId))
    .limit(1);
  const vehiculo = vehRows[0];
  if (!vehiculo?.teltonikaImei) {
    logger.info(
      { tripId, vehicleId: assignment.vehicleId },
      'recalcularNivelPostEntrega: vehicle sin Teltonika — sin upgrade del nivel',
    );
    return { recomputed: false };
  }

  // Usar pickupWindowStart como inicio del trip si no hay pickup_at real.
  // Es conservador: si el pickup real fue después, ampliamos la ventana
  // de búsqueda y dejamos al cálculo el filtrado por gaps de continuidad.
  const pickupAt = trip.pickupWindowStart ?? trip.createdAt;

  const distanciaEstimadaKm = existing.distanceKmEstimated
    ? Number(existing.distanceKmEstimated)
    : 0;

  const coveragePct = await calcularCobertura({
    db,
    logger,
    vehicleId: assignment.vehicleId,
    pickupAt,
    deliveredAt: assignment.deliveredAt,
    distanciaEstimadaKm,
  });

  const precisionMethod =
    (existing.precisionMethod as 'exacto_canbus' | 'modelado' | 'por_defecto' | null) ??
    'por_defecto';

  // routeDataSource sube a 'teltonika_gps' porque el vehículo tiene
  // device asociado y SI calculamos cobertura (puede ser 0 si no llegó
  // ningún ping, pero la fuente conceptual es Teltonika).
  const routeDataSource: RouteDataSource = 'teltonika_gps';

  const certificationLevel = derivarNivelCertificacion({
    precisionMethod,
    routeDataSource,
    coveragePct,
  });
  const uncertaintyFactor = calcularFactorIncertidumbre({
    nivelCertificacion: certificationLevel,
    coveragePct,
    vehicleTypeMatchesRoutesApi: true,
  });

  await db
    .update(tripMetrics)
    .set({
      routeDataSource,
      coveragePct: coveragePct.toString(),
      certificationLevel,
      uncertaintyFactor: uncertaintyFactor.toString(),
      updatedAt: sql`now()`,
    })
    .where(eq(tripMetrics.tripId, tripId));

  logger.info(
    {
      tripId,
      vehicleId: assignment.vehicleId,
      coveragePct,
      certificationLevel,
      uncertaintyFactor,
      precisionMethod,
    },
    'nivel de certificación recalculado post-entrega',
  );

  return { recomputed: true, certificationLevel, coveragePct };
}
