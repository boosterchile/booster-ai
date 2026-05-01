import type { Logger } from '@booster-ai/logger';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  type OfferRow,
  empresas,
  offers,
  tripEvents,
  tripRequests,
  vehicles,
  zones,
} from '../db/schema.js';
import { type NotifyOfferDeps, notifyOfferToCarrier } from './notify-offer.js';

/**
 * Configuración del matching MVP. Valores conservadores para piloto;
 * tunear con datos reales post-launch.
 */
const MATCHING_CONFIG = {
  /** Cuántas offers paralelas crear máximo por trip_request. */
  MAX_OFFERS_PER_REQUEST: 5,
  /** Cuánto vive una offer pending antes de expirar (minutos). */
  OFFER_TTL_MINUTES: 60,
  /** Descuento de score por slack de capacidad (vehículo grande para carga chica). */
  CAPACITY_SLACK_PENALTY: 0.1,
} as const;

export interface MatchingResult {
  tripRequestId: string;
  candidatesEvaluated: number;
  offersCreated: number;
  offers: OfferRow[];
}

export class TripRequestNotFoundError extends Error {
  constructor(public readonly tripRequestId: string) {
    super(`TripRequest ${tripRequestId} not found`);
    this.name = 'TripRequestNotFoundError';
  }
}

export class TripRequestNotMatchableError extends Error {
  constructor(
    public readonly tripRequestId: string,
    public readonly status: string,
  ) {
    super(`TripRequest ${tripRequestId} is in status ${status}, cannot run matching`);
    this.name = 'TripRequestNotMatchableError';
  }
}

/**
 * Matching engine MVP.
 *
 * Algoritmo (slice B.5 — simple, sin geo precisa):
 *   1. Carga el trip_request. Tiene que estar en 'pending_match'.
 *   2. Encuentra carriers candidatos:
 *      a. Empresa con is_carrier=true, status='active'.
 *      b. Tiene una zona con region_code = origin.region_code y
 *         zone_type IN ('pickup','both') y is_active=true.
 *      c. Tiene al menos un vehículo activo con capacity_kg >= cargo.weight_kg.
 *      Excluye empresas que ya tienen offer pending para este trip
 *      (UNIQUE en DB pero filtramos antes para no bloquear).
 *   3. Por cada carrier candidato, elige el "mejor" vehículo: el que tenga
 *      la capacidad MÁS CHICA que aún cumpla cargo.weight_kg (minimiza
 *      slack — un camión 25t para 1t es desperdicio). Score = 1.0 menos
 *      penalty proporcional al slack.
 *   4. Ordena candidatos por score desc, toma top MAX_OFFERS_PER_REQUEST.
 *   5. Inserta offers (status=pending, expires_at=now+60min).
 *   6. Cambia trip_request.status a 'offers_sent' (o 'expired' si 0 candidatos).
 *   7. Registra trip_events: matching_started + offers_sent (o
 *      offer_expired si no hubo candidatos). Append-only audit trail.
 *
 * Lo hace todo en una transacción para que el cambio de status y la
 * creación de offers sean atómicos.
 *
 * Slices posteriores (B.6+):
 *   - Geo precisa: distancia desde base operativa carrier al origen.
 *   - Historial: ratings, on-time delivery rate.
 *   - Cargo type compatibility: refrigerado va solo a vehículos refrigerados.
 *   - Pricing engine: precio dinámico vs proposed_price_clp.
 *   - Notification fan-out: WhatsApp/email/push tras crear offers.
 */
export interface RunMatchingOptions {
  db: Db;
  logger: Logger;
  tripRequestId: string;
  /**
   * Deps del dispatcher de notificaciones. Si se omiten, runMatching
   * crea las offers pero no dispara WhatsApp (útil en tests). En
   * producción se inyectan desde main.ts con el TwilioWhatsAppClient
   * singleton.
   */
  notify?: NotifyOfferDeps;
}

export async function runMatching(opts: RunMatchingOptions): Promise<MatchingResult> {
  const { db, logger, tripRequestId, notify } = opts;

  return await db
    .transaction(async (tx) => {
      // 1. Cargar trip_request.
      const tripRows = await tx
        .select()
        .from(tripRequests)
        .where(eq(tripRequests.id, tripRequestId))
        .limit(1);
      const trip = tripRows[0];
      if (!trip) {
        throw new TripRequestNotFoundError(tripRequestId);
      }
      if (trip.status !== 'pending_match') {
        throw new TripRequestNotMatchableError(tripRequestId, trip.status);
      }
      if (!trip.originRegionCode) {
        // Sin región origen no podemos hacer match. En piloto siempre viene
        // del form web; el bot WhatsApp legacy podría no tenerla todavía.
        throw new TripRequestNotMatchableError(tripRequestId, 'missing_origin_region');
      }

      // Cambiar status a 'matching' antes de empezar (defensa contra
      // concurrentes — UNIQUE constraint en assignment.trip_request_id evita
      // race condition real, pero esto es claridad operacional).
      await tx
        .update(tripRequests)
        .set({ status: 'matching', updatedAt: new Date() })
        .where(eq(tripRequests.id, tripRequestId));

      // Audit: matching empezó.
      await tx.insert(tripEvents).values({
        tripRequestId: trip.id,
        eventType: 'matching_started',
        payload: {
          origin_region: trip.originRegionCode,
          cargo_type: trip.cargoType,
          cargo_weight_kg: trip.cargoWeightKg,
        },
        source: 'system',
      });

      // 2. Buscar carriers candidatos.
      // Sub-query: empresas con zona pickup compatible.
      const candidateZones = await tx
        .select({ empresaId: zones.empresaId })
        .from(zones)
        .where(
          and(
            eq(zones.regionCode, trip.originRegionCode),
            inArray(zones.zoneType, ['pickup', 'both']),
            eq(zones.isActive, true),
          ),
        );
      const candidateEmpresaIds = [...new Set(candidateZones.map((z) => z.empresaId))];
      if (candidateEmpresaIds.length === 0) {
        logger.info({ tripRequestId, reason: 'no_zones' }, 'matching produced 0 candidates');
        return await finalizeNoCandidates(tx, trip.id, 'no_carrier_in_origin_region');
      }

      // Filtrar empresas que efectivamente son carriers activos.
      const candidateEmpresas = await tx
        .select()
        .from(empresas)
        .where(
          and(
            inArray(empresas.id, candidateEmpresaIds),
            eq(empresas.isCarrier, true),
            eq(empresas.status, 'active'),
          ),
        );
      if (candidateEmpresas.length === 0) {
        logger.info(
          { tripRequestId, reason: 'no_active_carriers' },
          'matching produced 0 candidates',
        );
        return await finalizeNoCandidates(tx, trip.id, 'no_active_carriers');
      }

      // 3. Por cada candidato, elegir mejor vehículo (capacidad mínima que
      // sirve). Si no tiene ninguno, descartar.
      const cargoWeight = trip.cargoWeightKg ?? 0;
      type Candidate = {
        empresaId: string;
        vehicleId: string;
        vehicleCapacityKg: number;
        score: number;
      };
      const candidates: Candidate[] = [];

      for (const emp of candidateEmpresas) {
        const vehs = await tx
          .select()
          .from(vehicles)
          .where(
            and(
              eq(vehicles.empresaId, emp.id),
              eq(vehicles.isActive, true),
              gte(vehicles.capacityKg, cargoWeight),
            ),
          )
          .orderBy(vehicles.capacityKg) // capacidad mínima primero (menos slack)
          .limit(1);
        const veh = vehs[0];
        if (!veh) {
          continue;
        }

        // Score base 1.0; penalizar slack proporcional. slack = (cap - peso) / cap.
        const slackRatio = cargoWeight > 0 ? (veh.capacityKg - cargoWeight) / veh.capacityKg : 0;
        const score = Math.max(0, 1 - slackRatio * MATCHING_CONFIG.CAPACITY_SLACK_PENALTY);

        candidates.push({
          empresaId: emp.id,
          vehicleId: veh.id,
          vehicleCapacityKg: veh.capacityKg,
          score,
        });
      }

      if (candidates.length === 0) {
        logger.info(
          { tripRequestId, reason: 'no_vehicle_with_capacity' },
          'matching produced 0 candidates',
        );
        return await finalizeNoCandidates(tx, trip.id, 'no_vehicle_with_capacity');
      }

      // 4. Top N por score.
      candidates.sort((a, b) => b.score - a.score);
      const topN = candidates.slice(0, MATCHING_CONFIG.MAX_OFFERS_PER_REQUEST);

      // 5. Crear offers.
      const expiresAt = new Date(Date.now() + MATCHING_CONFIG.OFFER_TTL_MINUTES * 60_000);
      const proposedPrice = trip.proposedPriceClp ?? 0;

      const created = await tx
        .insert(offers)
        .values(
          topN.map((c) => ({
            tripRequestId: trip.id,
            empresaId: c.empresaId,
            suggestedVehicleId: c.vehicleId,
            score: Math.round(c.score * 1000), // entero para evitar floats en DB
            status: 'pending' as const,
            proposedPriceClp: proposedPrice,
            expiresAt,
          })),
        )
        .returning();

      // 6. Cambiar trip_request a offers_sent.
      await tx
        .update(tripRequests)
        .set({ status: 'offers_sent', updatedAt: new Date() })
        .where(eq(tripRequests.id, trip.id));

      // 7. Audit: offers enviadas.
      await tx.insert(tripEvents).values({
        tripRequestId: trip.id,
        eventType: 'offers_sent',
        payload: {
          offer_ids: created.map((o) => o.id),
          empresa_ids: created.map((o) => o.empresaId),
          candidates_evaluated: candidates.length,
        },
        source: 'system',
      });

      logger.info(
        {
          tripRequestId,
          candidatesEvaluated: candidates.length,
          offersCreated: created.length,
        },
        'matching complete',
      );

      return {
        tripRequestId,
        candidatesEvaluated: candidates.length,
        offersCreated: created.length,
        offers: created,
      };
    })
    .then(async (result) => {
      // Fire-and-forget de las notificaciones — DESPUÉS de cerrar la
      // transacción para no inflar su latencia, pero esperando con
      // allSettled para que el caller (route handler) pueda saber si
      // todo salió bien antes de responder.
      //
      // Importante: un fallo de notificación NO debe corromper el
      // resultado del matching. Las offers ya están en DB y el carrier
      // puede verlas haciendo poll del dashboard. La notificación es
      // un nice-to-have que reduce time-to-response, no un requirement
      // duro del lifecycle.
      if (notify && result.offers.length > 0) {
        const settled = await Promise.allSettled(
          result.offers.map((offer) => notifyOfferToCarrier(notify, { offerId: offer.id })),
        );
        const failed = settled.filter((s) => s.status === 'rejected');
        if (failed.length > 0) {
          logger.error(
            {
              tripRequestId,
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
 * `expired` y registrar el evento. Devolver MatchingResult vacío para que
 * el caller no rompa.
 */
async function finalizeNoCandidates(
  tx: Parameters<Parameters<Db['transaction']>[0]>[0],
  tripRequestId: string,
  reason: string,
): Promise<MatchingResult> {
  await tx
    .update(tripRequests)
    .set({ status: 'expired', updatedAt: new Date() })
    .where(eq(tripRequests.id, tripRequestId));
  await tx.insert(tripEvents).values({
    tripRequestId,
    eventType: 'offer_expired',
    payload: { reason, candidates_evaluated: 0 },
    source: 'system',
  });
  return { tripRequestId, candidatesEvaluated: 0, offersCreated: 0, offers: [] };
}

// Re-exports usados internamente — desc no se usa pero se importa para
// futuras consultas de offers ordenadas por score.
void desc;
