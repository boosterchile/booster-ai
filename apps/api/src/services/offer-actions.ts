import type { Logger } from '@booster-ai/logger';
import { and, eq, ne } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  type AssignmentRow,
  type OfferRow,
  assignments,
  offers,
  tripEvents,
  tripRequests,
} from '../db/schema.js';

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
    super(`Offer ${offerId} is in status ${status}, not pending`);
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
 *   1. Verifica que la offer existe, pertenece a la empresa caller, está
 *      pending y no expirada.
 *   2. Actualiza offer.status = 'accepted', responded_at = now,
 *      response_channel = 'web'.
 *   3. Crea Assignment (status='assigned'). UNIQUE (trip_request_id) en DB
 *      previene race condition: si dos carriers aceptan al mismo tiempo,
 *      el segundo rompe con error de constraint y el route layer lo
 *      mapea a 409 already_assigned.
 *   4. Las demás offers del mismo trip_request pasan a 'superseded'.
 *   5. trip_request.status = 'assigned'.
 *   6. Insert trip_events: assignment_created + offer_accepted.
 */
export async function acceptOffer(opts: {
  db: Db;
  logger: Logger;
  offerId: string;
  empresaId: string;
  userId: string;
}): Promise<AcceptOfferResult> {
  const { db, logger, offerId, empresaId, userId } = opts;

  return await db.transaction(async (tx) => {
    // 1. Cargar y validar offer.
    const offerRows = await tx.select().from(offers).where(eq(offers.id, offerId)).limit(1);
    const offer = offerRows[0];
    if (!offer) {
      throw new OfferNotFoundError(offerId);
    }
    if (offer.empresaId !== empresaId) {
      throw new OfferNotOwnedError(offerId, empresaId);
    }
    if (offer.status !== 'pending') {
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
        status: 'accepted',
        respondedAt: now,
        responseChannel: 'web',
        updatedAt: now,
      })
      .where(eq(offers.id, offerId))
      .returning();
    if (!acceptedOffer) {
      throw new Error('Update offer returned no row');
    }

    // 3. Crear assignment. UNIQUE (trip_request_id) protege contra race.
    const [assignment] = await tx
      .insert(assignments)
      .values({
        tripRequestId: offer.tripRequestId,
        offerId: offer.id,
        empresaId: offer.empresaId,
        vehicleId: offer.suggestedVehicleId ?? '',
        status: 'assigned',
        agreedPriceClp: offer.proposedPriceClp,
        acceptedAt: now,
      })
      .returning();
    if (!assignment) {
      throw new Error('Insert assignment returned no row');
    }

    // 4. Otras offers del mismo trip pasan a superseded.
    const supersededRows = await tx
      .update(offers)
      .set({ status: 'superseded', updatedAt: now })
      .where(
        and(
          eq(offers.tripRequestId, offer.tripRequestId),
          ne(offers.id, offer.id),
          eq(offers.status, 'pending'),
        ),
      )
      .returning({ id: offers.id });

    // 5. trip_request → assigned.
    await tx
      .update(tripRequests)
      .set({ status: 'assigned', updatedAt: now })
      .where(eq(tripRequests.id, offer.tripRequestId));

    // 6. Audit events.
    await tx.insert(tripEvents).values([
      {
        tripRequestId: offer.tripRequestId,
        assignmentId: assignment.id,
        eventType: 'offer_accepted',
        payload: {
          offer_id: offer.id,
          empresa_id: empresaId,
          superseded_count: supersededRows.length,
        },
        source: 'web',
        recordedByUserId: userId,
      },
      {
        tripRequestId: offer.tripRequestId,
        assignmentId: assignment.id,
        eventType: 'assignment_created',
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
        tripRequestId: offer.tripRequestId,
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
  });
}

/**
 * Rechazar oferta — atómico, mucho más simple:
 *   1. Validar offer existe, pertenece, está pending.
 *   2. Marcar status='rejected' con razón opcional.
 *   3. Audit trip_event.
 *
 * NO cambiamos trip_request.status — otros carriers pueden todavía aceptar.
 * Si todas las offers terminan en rejected/expired sin assignment, un job
 * posterior (slice futuro) marca el trip_request como `expired`.
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
    if (offer.status !== 'pending') {
      throw new OfferNotPendingError(offerId, offer.status);
    }

    const now = new Date();
    const [rejected] = await tx
      .update(offers)
      .set({
        status: 'rejected',
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
      tripRequestId: offer.tripRequestId,
      eventType: 'offer_rejected',
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
        tripRequestId: offer.tripRequestId,
        empresaId,
        userId,
        reason,
      },
      'offer rejected',
    );

    return rejected;
  });
}
