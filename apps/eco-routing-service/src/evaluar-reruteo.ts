/**
 * evaluar-reruteo: Orchestrator de evaluación de alternativas de ruta ecológica.
 *
 * Flujo:
 *   1. Gate cooldown (puedeSugerir)
 *   2. Obtener estado del store (posición actual + baseline ETA)
 *   3. Guard: baseline <= 0 → skip (poisoned placeholder)
 *   4. computeRoutes con alternativas
 *   5. detectarDegradacion (¿hay degradación de tráfico?)
 *   6. Si degradado: evaluarAlternativas
 *   7. Si recomendada: persist INSERT en sugerencias_ruta
 *   8. registrarSugerencia (start cooldown)
 *   9. Return RouteSuggestion
 *
 * NEVER CRASHES: cada llamada externa está en try/catch. Si algo falla,
 * se loguea y se retorna null.
 */

import type { Logger } from '@booster-ai/logger';
import type { EvaluadorResult } from '@booster-ai/route-alternatives-evaluator';
import { evaluarAlternativas } from '@booster-ai/route-alternatives-evaluator';
import { computeRoutes } from '@booster-ai/routes-api-client';
import type {
  RouteSuggestion as ApiRouteSuggestion,
  VehicleEmissionType,
} from '@booster-ai/routes-api-client';
import { detectarDegradacion } from '@booster-ai/traffic-condition-detector';
import { trace } from '@opentelemetry/api';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { TripData } from './trip-data-reader.js';
import type { TripStateStore } from './trip-state-store.js';

export interface RouteSuggestion {
  polylineAlternativa: string;
  deltaEtaSegundos: number;
  deltaCo2eKg: number;
  etaBaselineSegundos: number;
  posicionLat: number;
  posicionLng: number;
}

export interface EvaluarReruteoOptions {
  store: TripStateStore;
  db: NodePgDatabase<Record<string, unknown>>;
  projectId: string;
  cooldownSegundos: number;
  logger: Logger;
  tripData: TripData;
}

/**
 * Maps DB fuelType (tipo_combustible) to Routes API VehicleEmissionType.
 * Returns undefined for unknown/unmapped types (Routes API will use default).
 */
function mapFuelTypeToEmissionType(fuelType: string | null): VehicleEmissionType | undefined {
  if (!fuelType) {
    return undefined;
  }
  switch (fuelType) {
    case 'gasolina':
      return 'GASOLINE';
    case 'electrico':
      return 'ELECTRIC';
    case 'hibrido_diesel':
    case 'hibrido_gasolina':
      return 'HYBRID';
    case 'diesel':
      return 'DIESEL';
    default:
      return undefined;
  }
}

const tracer = trace.getTracer('eco-routing-service');

export async function evaluarReruteo(
  viajeId: string,
  opts: EvaluarReruteoOptions,
): Promise<RouteSuggestion | null> {
  const { store, db, projectId, cooldownSegundos, logger, tripData } = opts;

  // 1. Gate cooldown
  if (!store.puedeSugerir(viajeId, cooldownSegundos)) {
    logger.debug({ viajeId }, 'evaluar-reruteo: cooldown activo, skip');
    return null;
  }

  // 2. Get estado from store
  const estado = store.getEstado(viajeId);
  if (
    !estado?.posicionActual ||
    estado.etaBaselineSegundos === null ||
    estado.etaBaselineSegundos === undefined
  ) {
    logger.debug({ viajeId }, 'evaluar-reruteo: sin estado/posicion/baseline, skip');
    return null;
  }

  const { etaBaselineSegundos, posicionActual } = estado;
  const { lat, lng } = posicionActual;

  // 3. Guard poisoned baseline (<= 0 means placeholder origin=dest ~0s from Task 5)
  if (etaBaselineSegundos <= 0) {
    logger.warn(
      { viajeId, etaBaselineSegundos },
      'evaluar-reruteo: baseline poisonado (<= 0), skip',
    );
    return null;
  }

  return tracer.startActiveSpan('eco-routing.evaluar-reruteo', async (span) => {
    span.setAttribute('viajeId', viajeId);

    try {
      // 4. computeRoutes
      let routes: ApiRouteSuggestion[];
      try {
        routes = await computeRoutes({
          projectId,
          origin: `${lat},${lng}`,
          destination: tripData.destinoAddressRaw,
          computeAlternatives: true,
          emissionType: mapFuelTypeToEmissionType(tripData.fuelType),
          logger,
        });
      } catch (err) {
        logger.error({ err, viajeId }, 'evaluar-reruteo: computeRoutes fallo (best-effort)');
        return null;
      }

      if (!routes || routes.length === 0) {
        logger.debug({ viajeId }, 'evaluar-reruteo: Routes API retorno vacio, skip');
        return null;
      }

      const firstRoute = routes[0];
      if (!firstRoute) {
        return null;
      }

      // 5. detectarDegradacion
      const degradacionResult = detectarDegradacion({
        etaEnVivoSegundos: firstRoute.durationS,
        etaBaselineSegundos,
        segundosHastaProximaDivergencia: 300,
      });

      span.setAttribute('degradado', degradacionResult.degradado);

      if (!degradacionResult.degradado) {
        logger.debug({ viajeId }, 'evaluar-reruteo: sin degradacion, skip');
        return null;
      }

      // 6. Mapear rutas a AlternativaInput y evaluarAlternativas
      const alternativas = routes.map((r) => ({
        polyline: r.polylineEncoded,
        distanciaKm: r.distanceKm,
        duracionSegundos: r.durationS,
        fuelLitros: r.fuelL,
      }));

      let evalResult: EvaluadorResult;
      try {
        evalResult = evaluarAlternativas({
          alternativas,
          fuelType: tripData.fuelType ?? 'diesel',
          guardrailEtaPct: 0.1,
        });
      } catch (err) {
        logger.error({ err, viajeId }, 'evaluar-reruteo: evaluarAlternativas fallo (best-effort)');
        return null;
      }

      span.setAttribute('recomendo', evalResult.tipo === 'recomendada');

      if (evalResult.tipo === 'ninguna_mejor') {
        logger.debug({ viajeId }, 'evaluar-reruteo: ninguna_mejor, skip');
        return null;
      }

      const { polyline, deltaEtaSegundos, deltaCo2eKg } = evalResult;

      span.setAttribute('deltaEta', deltaEtaSegundos);
      span.setAttribute('deltaCo2e', deltaCo2eKg);

      // 7. Persist to sugerencias_ruta
      try {
        await db.execute(sql`
          INSERT INTO sugerencias_ruta (
            viaje_id, emitida_en, polyline_alternativa,
            delta_eta_segundos, delta_co2e_kg, eta_baseline_segundos,
            posicion_lat, posicion_lng
          ) VALUES (
            ${viajeId}, NOW(), ${polyline},
            ${deltaEtaSegundos}, ${String(deltaCo2eKg)}::numeric, ${etaBaselineSegundos},
            ${String(lat)}::numeric, ${String(lng)}::numeric
          )
        `);
      } catch (err) {
        logger.error({ err, viajeId }, 'evaluar-reruteo: DB INSERT fallo (best-effort), skip');
        return null;
      }

      // 8. Registrar sugerencia (start cooldown)
      store.registrarSugerencia(viajeId);

      const suggestion: RouteSuggestion = {
        polylineAlternativa: polyline,
        deltaEtaSegundos,
        deltaCo2eKg,
        etaBaselineSegundos,
        posicionLat: lat,
        posicionLng: lng,
      };

      logger.info(
        { viajeId, deltaEtaSegundos, deltaCo2eKg },
        'evaluar-reruteo: sugerencia emitida',
      );

      return suggestion;
    } finally {
      span.end();
    }
  });
}
