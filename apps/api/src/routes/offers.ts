import type { Logger } from '@booster-ai/logger';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { offers, tripRequests } from '../db/schema.js';
import {
  OfferExpiredError,
  OfferNotFoundError,
  OfferNotOwnedError,
  OfferNotPendingError,
  acceptOffer,
  rejectOffer,
} from '../services/offer-actions.js';

/**
 * Endpoints para que carriers vean y respondan ofertas.
 *
 *   - GET    /offers/mine         → lista offers del activeMembership.empresa
 *   - POST   /offers/:id/accept   → acepta, crea assignment, supersede otras
 *   - POST   /offers/:id/reject   → rechaza con razón opcional
 *
 * Todos requieren firebaseAuth + userContext middlewares en el chain.
 *
 * GET /offers/mine soporta filter por status (default: pending). Devuelve
 * data joined con trip_request para que el cliente arme cards sin hacer
 * un fetch adicional por offer.
 */

const acceptBodySchema = z.object({
  /**
   * Si carrier quiere usar otro vehículo distinto al sugerido, pasarlo acá.
   * Slice futuro: validar que es propio + capacidad suficiente. MVP solo
   * acepta el suggested_vehicle_id que ya viene en la offer.
   */
  override_vehicle_id: z.string().uuid().optional(),
});

const rejectBodySchema = z.object({
  /** Razón opcional. Útil para analytics — entender por qué se rechazan. */
  reason: z.string().min(1).max(500).optional(),
});

export function createOfferRoutes(opts: { db: Db; logger: Logger }) {
  const app = new Hono();

  // GET /offers/mine?status=pending
  app.get('/mine', async (c) => {
    const userContext = c.get('userContext');
    if (!userContext) {
      opts.logger.error({ path: c.req.path }, '/offers/mine without userContext');
      return c.json({ error: 'internal_server_error' }, 500);
    }
    const active = userContext.activeMembership;
    if (!active) {
      return c.json({ error: 'no_active_empresa', code: 'no_active_empresa' }, 403);
    }
    if (!active.empresa.isCarrier) {
      return c.json({ error: 'not_a_carrier', code: 'not_a_carrier' }, 403);
    }

    const statusParam = c.req.query('status');
    const allowedStatus = ['pending', 'accepted', 'rejected', 'expired', 'superseded'] as const;
    type OfferStatus = (typeof allowedStatus)[number];
    const status: OfferStatus =
      statusParam && (allowedStatus as readonly string[]).includes(statusParam)
        ? (statusParam as OfferStatus)
        : 'pending';

    // Join offers + trip_requests para que el cliente reciba todo en una
    // sola query. Filter por empresa = activeMembership.
    const rows = await opts.db
      .select({ offer: offers, trip: tripRequests })
      .from(offers)
      .innerJoin(tripRequests, eq(offers.tripRequestId, tripRequests.id))
      .where(and(eq(offers.empresaId, active.empresa.id), eq(offers.status, status)))
      .orderBy(desc(offers.sentAt));

    return c.json({
      offers: rows.map((r) => ({
        id: r.offer.id,
        status: r.offer.status,
        score: r.offer.score / 1000, // de-normalizar el entero ×1000
        proposed_price_clp: r.offer.proposedPriceClp,
        suggested_vehicle_id: r.offer.suggestedVehicleId,
        sent_at: r.offer.sentAt,
        expires_at: r.offer.expiresAt,
        responded_at: r.offer.respondedAt,
        rejection_reason: r.offer.rejectionReason,
        trip_request: {
          id: r.trip.id,
          tracking_code: r.trip.trackingCode,
          status: r.trip.status,
          origin_address_raw: r.trip.originAddressRaw,
          origin_region_code: r.trip.originRegionCode,
          destination_address_raw: r.trip.destinationAddressRaw,
          destination_region_code: r.trip.destinationRegionCode,
          cargo_type: r.trip.cargoType,
          cargo_weight_kg: r.trip.cargoWeightKg,
          pickup_window_start: r.trip.pickupWindowStart,
          pickup_window_end: r.trip.pickupWindowEnd,
        },
      })),
    });
  });

  // POST /offers/:id/accept
  app.post('/:id/accept', zValidator('json', acceptBodySchema), async (c) => {
    const userContext = c.get('userContext');
    if (!userContext) {
      return c.json({ error: 'internal_server_error' }, 500);
    }
    const active = userContext.activeMembership;
    if (!active) {
      return c.json({ error: 'no_active_empresa', code: 'no_active_empresa' }, 403);
    }
    if (!active.empresa.isCarrier) {
      return c.json({ error: 'not_a_carrier', code: 'not_a_carrier' }, 403);
    }

    const offerId = c.req.param('id');

    try {
      const result = await acceptOffer({
        db: opts.db,
        logger: opts.logger,
        offerId,
        empresaId: active.empresa.id,
        userId: userContext.user.id,
      });
      return c.json(
        {
          offer: {
            id: result.offer.id,
            status: result.offer.status,
            responded_at: result.offer.respondedAt,
          },
          assignment: {
            id: result.assignment.id,
            trip_request_id: result.assignment.tripRequestId,
            status: result.assignment.status,
            agreed_price_clp: result.assignment.agreedPriceClp,
            accepted_at: result.assignment.acceptedAt,
          },
          superseded_offer_ids: result.supersededOfferIds,
        },
        201,
      );
    } catch (err) {
      if (err instanceof OfferNotFoundError) {
        return c.json({ error: 'offer_not_found', code: 'offer_not_found' }, 404);
      }
      if (err instanceof OfferNotOwnedError) {
        return c.json({ error: 'offer_forbidden', code: 'offer_forbidden' }, 403);
      }
      if (err instanceof OfferNotPendingError) {
        return c.json(
          { error: 'offer_not_pending', code: 'offer_not_pending', status: err.status },
          409,
        );
      }
      if (err instanceof OfferExpiredError) {
        return c.json({ error: 'offer_expired', code: 'offer_expired' }, 409);
      }
      // UNIQUE constraint en assignment.trip_request_id si dos carriers
      // aceptan al mismo tiempo: el segundo throw error de DB. Drizzle lo
      // expone como Error con cause. Slice posterior puede mapear más fino.
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.toLowerCase().includes('unique') || errMsg.toLowerCase().includes('duplicate')) {
        opts.logger.warn({ err, offerId }, 'race condition: trip already assigned');
        return c.json({ error: 'trip_already_assigned', code: 'trip_already_assigned' }, 409);
      }
      opts.logger.error({ err, offerId }, 'unexpected error in /offers/:id/accept');
      throw err;
    }
  });

  // POST /offers/:id/reject
  app.post('/:id/reject', zValidator('json', rejectBodySchema), async (c) => {
    const userContext = c.get('userContext');
    if (!userContext) {
      return c.json({ error: 'internal_server_error' }, 500);
    }
    const active = userContext.activeMembership;
    if (!active) {
      return c.json({ error: 'no_active_empresa', code: 'no_active_empresa' }, 403);
    }
    if (!active.empresa.isCarrier) {
      return c.json({ error: 'not_a_carrier', code: 'not_a_carrier' }, 403);
    }

    const offerId = c.req.param('id');
    const body = c.req.valid('json');

    try {
      const offer = await rejectOffer({
        db: opts.db,
        logger: opts.logger,
        offerId,
        empresaId: active.empresa.id,
        userId: userContext.user.id,
        reason: body.reason,
      });
      return c.json({
        offer: {
          id: offer.id,
          status: offer.status,
          responded_at: offer.respondedAt,
          rejection_reason: offer.rejectionReason,
        },
      });
    } catch (err) {
      if (err instanceof OfferNotFoundError) {
        return c.json({ error: 'offer_not_found', code: 'offer_not_found' }, 404);
      }
      if (err instanceof OfferNotOwnedError) {
        return c.json({ error: 'offer_forbidden', code: 'offer_forbidden' }, 403);
      }
      if (err instanceof OfferNotPendingError) {
        return c.json(
          { error: 'offer_not_pending', code: 'offer_not_pending', status: err.status },
          409,
        );
      }
      opts.logger.error({ err, offerId }, 'unexpected error in /offers/:id/reject');
      throw err;
    }
  });

  return app;
}
