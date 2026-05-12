import type { Logger } from '@booster-ai/logger';
import {
  MATCHING_CONFIG,
  type NoCandidatesReason,
  type ScoredCandidate,
  type ScoredCandidateV2,
  scoreCandidate,
  scoreCandidateV2,
  scoreToInt,
  scoreToIntV2,
  selectTopNCandidates,
  selectTopNCandidatesV2,
} from '@booster-ai/matching-algorithm';
import { and, eq, gte, inArray } from 'drizzle-orm';
import { config as appConfig } from '../config.js';
import type { Db } from '../db/client.js';
import {
  type OfferRow,
  empresas,
  offers,
  tripEvents,
  trips,
  vehicles,
  zones,
} from '../db/schema.js';
import { buildCandidateV2, lookupCarriersForV2 } from './matching-v2-lookups.js';
import { resolveMatchingV2Weights } from './matching-v2-weights.js';
import { type NotifyOfferDeps, notifyOfferToCarrier } from './notify-offer.js';

/**
 * Orquestador del matching engine. La LÓGICA pura
 * (scoring, top-N, config) vive en `@booster-ai/matching-algorithm`. Acá
 * sólo hacemos las queries Drizzle y persistimos resultados.
 *
 * Slice B.5 — algoritmo simple sin geo precisa:
 *   1. Carga el viaje. Tiene que estar en 'esperando_match'.
 *   2. Encuentra empresas transportistas candidatas:
 *      a. Empresa con es_transportista=true, estado='activa'.
 *      b. Tiene una zona con codigo_region = origen.region_code y
 *         tipo_zona IN ('recogida','ambos') y es_activa=true.
 *      c. Tiene al menos un vehículo activo con capacidad_kg >= peso.
 *   3. Por cada candidato, elige el "mejor" vehículo (capacidad mínima
 *      que aún sirve) y calcula score con scoreCandidate().
 *   4. Top N por score (selectTopNCandidates).
 *   5. Inserta offers (estado=pendiente, expira_en=now+TTL).
 *   6. Cambia trip.estado a 'ofertas_enviadas' (o 'expirado' si 0 candidatos).
 *   7. Registra eventos_viaje: matching_iniciado + ofertas_enviadas.
 */

export interface MatchingResult {
  tripId: string;
  candidatesEvaluated: number;
  offersCreated: number;
  offers: OfferRow[];
}

export class TripRequestNotFoundError extends Error {
  constructor(public readonly tripId: string) {
    super(`Trip ${tripId} not found`);
    this.name = 'TripRequestNotFoundError';
  }
}

export class TripRequestNotMatchableError extends Error {
  constructor(
    public readonly tripId: string,
    public readonly status: string,
  ) {
    super(`Trip ${tripId} is in status ${status}, cannot run matching`);
    this.name = 'TripRequestNotMatchableError';
  }
}

export interface RunMatchingOptions {
  db: Db;
  logger: Logger;
  tripId: string;
  /**
   * Deps del dispatcher de notificaciones. Si se omiten, runMatching crea
   * las offers pero no dispara WhatsApp (útil en tests).
   */
  notify?: NotifyOfferDeps;
}

export async function runMatching(opts: RunMatchingOptions): Promise<MatchingResult> {
  const { db, logger, tripId, notify } = opts;

  return await db
    .transaction(async (tx) => {
      // 1. Cargar trip.
      const tripRows = await tx.select().from(trips).where(eq(trips.id, tripId)).limit(1);
      const trip = tripRows[0];
      if (!trip) {
        throw new TripRequestNotFoundError(tripId);
      }
      if (trip.status !== 'esperando_match') {
        throw new TripRequestNotMatchableError(tripId, trip.status);
      }
      if (!trip.originRegionCode) {
        throw new TripRequestNotMatchableError(tripId, 'missing_origin_region');
      }

      // Cambiar status a 'emparejando' antes de empezar.
      await tx
        .update(trips)
        .set({ status: 'emparejando', updatedAt: new Date() })
        .where(eq(trips.id, tripId));

      // Audit: matching empezó.
      await tx.insert(tripEvents).values({
        tripId: trip.id,
        eventType: 'matching_iniciado',
        payload: {
          origin_region: trip.originRegionCode,
          cargo_type: trip.cargoType,
          cargo_weight_kg: trip.cargoWeightKg,
        },
        source: 'sistema',
      });

      // 2. Sub-query: empresas con zona pickup compatible.
      const candidateZones = await tx
        .select({ empresaId: zones.empresaId })
        .from(zones)
        .where(
          and(
            eq(zones.regionCode, trip.originRegionCode),
            inArray(zones.zoneType, ['recogida', 'ambos']),
            eq(zones.isActive, true),
          ),
        );
      const candidateEmpresaIds = [...new Set(candidateZones.map((z) => z.empresaId))];
      if (candidateEmpresaIds.length === 0) {
        logger.info({ tripId, reason: 'no_zones' }, 'matching produced 0 candidates');
        return await finalizeNoCandidates(tx, trip.id, 'no_carrier_in_origin_region');
      }

      // Filtrar empresas que efectivamente son transportistas activos.
      const candidateEmpresas = await tx
        .select()
        .from(empresas)
        .where(
          and(
            inArray(empresas.id, candidateEmpresaIds),
            eq(empresas.isTransportista, true),
            eq(empresas.status, 'activa'),
          ),
        );
      if (candidateEmpresas.length === 0) {
        logger.info({ tripId, reason: 'no_active_carriers' }, 'matching produced 0 candidates');
        return await finalizeNoCandidates(tx, trip.id, 'no_active_carriers');
      }

      // 3. Por cada candidato, elegir vehículo más ajustado y scorear.
      //    Si MATCHING_ALGORITHM_V2_ACTIVATED, hacemos lookups extras
      //    (trips activos, histórico 7d, ofertas 90d, tier) para llenar
      //    los inputs de `scoreCandidateV2`. Sino, usamos `scoreCandidate`
      //    v1 capacity-only.
      const cargoWeight = trip.cargoWeightKg ?? 0;
      const algorithmVersion: 'v1' | 'v2' = appConfig.MATCHING_ALGORITHM_V2_ACTIVATED ? 'v2' : 'v1';

      // Lookups v2 (sólo si flag está on). Una sola call batch para
      // todas las empresas — devuelve Map por empresaId con defaults
      // para las que no tienen historial.
      const v2Lookups = appConfig.MATCHING_ALGORITHM_V2_ACTIVATED
        ? await lookupCarriersForV2({
            db: tx,
            logger,
            empresaIds: candidateEmpresas.map((e) => e.id),
            originRegionCode: trip.originRegionCode,
          })
        : null;
      const v2Weights = appConfig.MATCHING_ALGORITHM_V2_ACTIVATED
        ? resolveMatchingV2Weights(logger)
        : null;

      const candidatesV1: ScoredCandidate[] = [];
      const candidatesV2: ScoredCandidateV2[] = [];

      for (const emp of candidateEmpresas) {
        const vehs = await tx
          .select()
          .from(vehicles)
          .where(
            and(
              eq(vehicles.empresaId, emp.id),
              eq(vehicles.vehicleStatus, 'activo'),
              gte(vehicles.capacityKg, cargoWeight),
            ),
          )
          .orderBy(vehicles.capacityKg)
          .limit(1);
        const veh = vehs[0];
        if (!veh) {
          continue;
        }

        const vehicleCapacityKg = veh.capacityKg;

        if (algorithmVersion === 'v2' && v2Lookups && v2Weights) {
          const lookup = v2Lookups.get(emp.id);
          if (!lookup) {
            // No debería pasar (Map debe tener entry por empresaId).
            // Defensa: skip.
            continue;
          }
          const candidate = buildCandidateV2({
            empresaId: emp.id,
            vehicleId: veh.id,
            vehicleCapacityKg,
            lookup,
          });
          const scored = scoreCandidateV2(
            candidate,
            { cargoWeightKg: cargoWeight, originRegionCode: trip.originRegionCode },
            v2Weights,
          );
          candidatesV2.push(scored);
        } else {
          const score = scoreCandidate(
            { empresaId: emp.id, vehicleId: veh.id, vehicleCapacityKg },
            cargoWeight,
          );
          candidatesV1.push({
            empresaId: emp.id,
            vehicleId: veh.id,
            vehicleCapacityKg,
            score,
          });
        }
      }

      const candidatesCount = candidatesV1.length + candidatesV2.length;
      if (candidatesCount === 0) {
        logger.info(
          { tripId, reason: 'no_vehicle_with_capacity', algorithmVersion },
          'matching produced 0 candidates',
        );
        return await finalizeNoCandidates(tx, trip.id, 'no_vehicle_with_capacity');
      }

      // 4. Top N por score (rama según versión del algoritmo).
      const expiresAt = new Date(Date.now() + MATCHING_CONFIG.OFFER_TTL_MINUTES * 60_000);
      const proposedPrice = trip.proposedPriceClp ?? 0;

      const offerRowsToInsert =
        algorithmVersion === 'v2'
          ? selectTopNCandidatesV2(candidatesV2, MATCHING_CONFIG.MAX_OFFERS_PER_REQUEST).map(
              (c) => ({
                tripId: trip.id,
                empresaId: c.empresaId,
                suggestedVehicleId: c.vehicleId,
                score: scoreToIntV2(c.score),
                status: 'pendiente' as const,
                proposedPriceClp: proposedPrice,
                expiresAt,
              }),
            )
          : selectTopNCandidates(candidatesV1).map((c) => ({
              tripId: trip.id,
              empresaId: c.empresaId,
              suggestedVehicleId: c.vehicleId,
              score: scoreToInt(c.score),
              status: 'pendiente' as const,
              proposedPriceClp: proposedPrice,
              expiresAt,
            }));

      // 5. Crear offers.
      const created = await tx.insert(offers).values(offerRowsToInsert).returning();

      // Log estructurado del v2 score breakdown para observabilidad.
      // Permite reconstruir por qué cada carrier recibió oferta —
      // requerimiento de ADR-033 §10 (métricas observables).
      if (algorithmVersion === 'v2' && candidatesV2.length > 0) {
        const topV2 = selectTopNCandidatesV2(candidatesV2, MATCHING_CONFIG.MAX_OFFERS_PER_REQUEST);
        logger.info(
          {
            tripId,
            algorithmVersion,
            weights: v2Weights,
            candidates_scored: topV2.map((c) => ({
              empresaId: c.empresaId,
              vehicleId: c.vehicleId,
              score: c.score,
              components: c.components,
              backhaul_signal: c.backhaulSignal,
            })),
          },
          'matching v2: score breakdown',
        );
      }

      // 6. Cambiar trip a ofertas_enviadas.
      await tx
        .update(trips)
        .set({ status: 'ofertas_enviadas', updatedAt: new Date() })
        .where(eq(trips.id, trip.id));

      // 7. Audit: ofertas enviadas.
      await tx.insert(tripEvents).values({
        tripId: trip.id,
        eventType: 'ofertas_enviadas',
        payload: {
          offer_ids: created.map((o) => o.id),
          empresa_ids: created.map((o) => o.empresaId),
          candidates_evaluated: candidatesCount,
          algorithm_version: algorithmVersion,
        },
        source: 'sistema',
      });

      logger.info(
        {
          tripId,
          candidatesEvaluated: candidatesCount,
          offersCreated: created.length,
          algorithmVersion,
        },
        'matching complete',
      );

      return {
        tripId,
        candidatesEvaluated: candidatesCount,
        offersCreated: created.length,
        offers: created,
      };
    })
    .then(async (result) => {
      // Fire-and-forget de las notificaciones — DESPUÉS de cerrar la
      // transacción para no inflar su latencia.
      if (notify && result.offers.length > 0) {
        const settled = await Promise.allSettled(
          result.offers.map((offer) => notifyOfferToCarrier(notify, { offerId: offer.id })),
        );
        const failed = settled.filter((s) => s.status === 'rejected');
        if (failed.length > 0) {
          logger.error(
            {
              tripId,
              offersCreated: result.offers.length,
              notificationsFailed: failed.length,
              errors: failed
                .map((f) => (f.status === 'rejected' ? String(f.reason) : null))
                .filter(Boolean),
            },
            'matching: una o más notificaciones fallaron (offers ya en DB)',
          );
        }
      }
      return result;
    });
}

/**
 * Helper: cuando matching no encuentra candidatos, marcar el trip como
 * `expirado` y registrar el evento.
 */
async function finalizeNoCandidates(
  tx: Parameters<Parameters<Db['transaction']>[0]>[0],
  tripId: string,
  reason: NoCandidatesReason,
): Promise<MatchingResult> {
  await tx
    .update(trips)
    .set({ status: 'expirado', updatedAt: new Date() })
    .where(eq(trips.id, tripId));
  await tx.insert(tripEvents).values({
    tripId,
    eventType: 'oferta_expirada',
    payload: { reason, candidates_evaluated: 0 },
    source: 'sistema',
  });
  return { tripId, candidatesEvaluated: 0, offersCreated: 0, offers: [] };
}
