import type { Logger } from '@booster-ai/logger';
import { and, eq, ne } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  type AssignmentRow,
  type OfferRow,
  assignments,
  offers,
  tripEvents,
  trips,
} from '../db/schema.js';
import { calcularMetricasEstimadas } from './calcular-metricas-viaje.js';

/**
 * Errores tipados para mapear a HTTP status en el route layer.
 */
export class OfferNotFoundError extends Error {
  constructor(public readonly offerId: string) {
    super(`Offer ${offerId} not found`);
    this.name = 'OfferNotFoundError';
  }
}

export class OfferNotOwnedError extends Error {
  constructor(
    public readonly offerId: string,
    public readonly empresaId: string,
  ) {
    super(`Offer ${offerId} does not belong to empresa ${empresaId}`);
    this.name = 'OfferNotOwnedError';
  }
}

export class OfferNotPendingError extends Error {
  constructor(
    public readonly offerId: string,
    public readonly status: string,
  ) {
    super(`Offer ${offerId} is in status ${status}, not pendiente`);
    this.name = 'OfferNotPendingError';
  }
}

export class OfferExpiredError extends Error {
  constructor(public readonly offerId: string) {
    super(`Offer ${offerId} has expired`);
    this.name = 'OfferExpiredError';
  }
}

export interface AcceptOfferResult {
  offer: OfferRow;
  assignment: AssignmentRow;
  supersededOfferIds: string[];
}

/**
 * Aceptar oferta — atómico:
 *   1. Verifica offer existe, pertenece a la empresa, está pendiente y no expirada.
 *   2. Update offer.estado='aceptada', respondido_en=now, canal_respuesta='web'.
 *   3. Crea Assignment (estado='asignado'). UNIQUE (viaje_id) en DB previene
 *      race condition: si dos transportistas aceptan al mismo tiempo, el
 *      segundo rompe con error de constraint y el route layer lo mapea a
 *      409 already_assigned.
 *   4. Las demás offers del mismo viaje pasan a 'reemplazada'.
 *   5. trip.estado = 'asignado'.
 *   6. Insert eventos_viaje: asignacion_creada + oferta_aceptada.
 */
export async function acceptOffer(opts: {
  db: Db;
  logger: Logger;
  offerId: string;
  empresaId: string;
  userId: string;
}): Promise<AcceptOfferResult> {
  const { db, logger, offerId, empresaId, userId } = opts;

  return await db
    .transaction(async (tx) => {
      // 1. Cargar y validar offer.
      const offerRows = await tx.select().from(offers).where(eq(offers.id, offerId)).limit(1);
      const offer = offerRows[0];
      if (!offer) {
        throw new OfferNotFoundError(offerId);
      }
      if (offer.empresaId !== empresaId) {
        throw new OfferNotOwnedError(offerId, empresaId);
      }
      if (offer.status !== 'pendiente') {
        throw new OfferNotPendingError(offerId, offer.status);
      }
      if (offer.expiresAt.getTime() < Date.now()) {
        throw new OfferExpiredError(offerId);
      }

      const now = new Date();

      // 2. Marcar offer aceptada.
      const [acceptedOffer] = await tx
        .update(offers)
        .set({
          status: 'aceptada',
          respondedAt: now,
          responseChannel: 'web',
          updatedAt: now,
        })
        .where(eq(offers.id, offerId))
        .returning();
      if (!acceptedOffer) {
        throw new Error('Update offer returned no row');
      }

      // 3. Crear assignment. UNIQUE (viaje_id) protege contra race.
      const [assignment] = await tx
        .insert(assignments)
        .values({
          tripId: offer.tripId,
          offerId: offer.id,
          empresaId: offer.empresaId,
          vehicleId: offer.suggestedVehicleId ?? '',
          status: 'asignado',
          agreedPriceClp: offer.proposedPriceClp,
          acceptedAt: now,
        })
        .returning();
      if (!assignment) {
        throw new Error('Insert assignment returned no row');
      }

      // 4. Otras offers del mismo trip pasan a reemplazada.
      const supersededRows = await tx
        .update(offers)
        .set({ status: 'reemplazada', updatedAt: now })
        .where(
          and(
            eq(offers.tripId, offer.tripId),
            ne(offers.id, offer.id),
            eq(offers.status, 'pendiente'),
          ),
        )
        .returning({ id: offers.id });

      // 5. trip → asignado.
      await tx
        .update(trips)
        .set({ status: 'asignado', updatedAt: now })
        .where(eq(trips.id, offer.tripId));

      // 6. Audit events.
      await tx.insert(tripEvents).values([
        {
          tripId: offer.tripId,
          assignmentId: assignment.id,
          eventType: 'oferta_aceptada',
          payload: {
            offer_id: offer.id,
            empresa_id: empresaId,
            superseded_count: supersededRows.length,
          },
          source: 'web',
          recordedByUserId: userId,
        },
        {
          tripId: offer.tripId,
          assignmentId: assignment.id,
          eventType: 'asignacion_creada',
          payload: {
            assignment_id: assignment.id,
            empresa_id: empresaId,
            vehicle_id: assignment.vehicleId,
            agreed_price_clp: assignment.agreedPriceClp,
          },
          source: 'web',
          recordedByUserId: userId,
        },
      ]);

      logger.info(
        {
          offerId: offer.id,
          assignmentId: assignment.id,
          tripId: offer.tripId,
          empresaId,
          userId,
          supersededCount: supersededRows.length,
        },
        'offer accepted',
      );

      return {
        offer: acceptedOffer,
        assignment,
        supersededOfferIds: supersededRows.map((r) => r.id),
      };
    })
    .then(async (result) => {
      // Cálculo de métricas de carbono — fire-and-forget post-commit. Si
      // falla, queda assignment sin métricas (recalculable después por cron
      // o admin); no bloquea el accept response al carrier.
      try {
        const metricas = await calcularMetricasEstimadas({
          db,
          logger,
          tripId: result.assignment.tripId,
          vehicleId: result.assignment.vehicleId || null,
        });
        logger.info(
          {
            tripId: result.assignment.tripId,
            assignmentId: result.assignment.id,
            metodoPrecision: metricas.emisiones.metodoPrecision,
            emisionesKgco2eWtw: metricas.emisiones.emisionesKgco2eWtw,
            intensidadGco2ePorTonKm: metricas.emisiones.intensidadGco2ePorTonKm,
          },
          'metricas estimadas calculadas tras accept',
        );
      } catch (err) {
        logger.error(
          { err, tripId: result.assignment.tripId, assignmentId: result.assignment.id },
          'fallo calcular metricas estimadas tras accept (asignacion creada igual; recalcular despues)',
        );
      }
      return result;
    });
}

/**
 * Rechazar oferta — atómico, mucho más simple:
 *   1. Validar offer existe, pertenece, está pendiente.
 *   2. Marcar estado='rechazada' con razón opcional.
 *   3. Audit trip_event.
 *
 * NO cambiamos trip.estado — otros transportistas pueden todavía aceptar.
 * Si todas las offers terminan en rechazada/expirada sin assignment, un
 * job posterior marca el trip como `expirado`.
 */
export async function rejectOffer(opts: {
  db: Db;
  logger: Logger;
  offerId: string;
  empresaId: string;
  userId: string;
  reason: string | undefined;
}): Promise<OfferRow> {
  const { db, logger, offerId, empresaId, userId, reason } = opts;

  return await db.transaction(async (tx) => {
    const offerRows = await tx.select().from(offers).where(eq(offers.id, offerId)).limit(1);
    const offer = offerRows[0];
    if (!offer) {
      throw new OfferNotFoundError(offerId);
    }
    if (offer.empresaId !== empresaId) {
      throw new OfferNotOwnedError(offerId, empresaId);
    }
    if (offer.status !== 'pendiente') {
      throw new OfferNotPendingError(offerId, offer.status);
    }

    const now = new Date();
    const [rejected] = await tx
      .update(offers)
      .set({
        status: 'rechazada',
        respondedAt: now,
        responseChannel: 'web',
        ...(reason ? { rejectionReason: reason } : {}),
        updatedAt: now,
      })
      .where(eq(offers.id, offerId))
      .returning();
    if (!rejected) {
      throw new Error('Update offer returned no row');
    }

    await tx.insert(tripEvents).values({
      tripId: offer.tripId,
      eventType: 'oferta_rechazada',
      payload: {
        offer_id: offer.id,
        empresa_id: empresaId,
        ...(reason ? { reason } : {}),
      },
      source: 'web',
      recordedByUserId: userId,
    });

    logger.info(
      {
        offerId: offer.id,
        tripId: offer.tripId,
        empresaId,
        userId,
        reason,
      },
      'offer rejected',
    );

    return rejected;
  });
}
