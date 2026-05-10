import type { Logger } from '@booster-ai/logger';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { config } from '../config.js';
import type { Db } from '../db/client.js';
import { offers, trips } from '../db/schema.js';
import {
  OfferForbiddenForPreviewError,
  OfferNotFoundForPreviewError,
  generarEcoPreview,
} from '../services/eco-route-preview.js';
import {
  OfferExpiredError,
  OfferNotFoundError,
  OfferNotOwnedError,
  OfferNotPendingError,
  acceptOffer,
  rejectOffer,
} from '../services/offer-actions.js';

/**
 * Endpoints para que transportistas vean y respondan ofertas.
 *
 *   - GET    /offers/mine         → lista offers del activeMembership.empresa
 *   - POST   /offers/:id/accept   → acepta, crea assignment, reemplaza otras
 *   - POST   /offers/:id/reject   → rechaza con razón opcional
 */

const acceptBodySchema = z.object({
  override_vehicle_id: z.string().uuid().optional(),
});

const rejectBodySchema = z.object({
  reason: z.string().min(1).max(500).optional(),
});

export function createOfferRoutes(opts: { db: Db; logger: Logger }) {
  const app = new Hono();

  // GET /offers/mine?status=pendiente
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
    if (!active.empresa.isTransportista) {
      return c.json({ error: 'not_a_carrier', code: 'not_a_carrier' }, 403);
    }

    const statusParam = c.req.query('status');
    const allowedStatus = [
      'pendiente',
      'aceptada',
      'rechazada',
      'expirada',
      'reemplazada',
    ] as const;
    type OfferStatus = (typeof allowedStatus)[number];
    const status: OfferStatus =
      statusParam && (allowedStatus as readonly string[]).includes(statusParam)
        ? (statusParam as OfferStatus)
        : 'pendiente';

    const rows = await opts.db
      .select({ offer: offers, trip: trips })
      .from(offers)
      .innerJoin(trips, eq(offers.tripId, trips.id))
      .where(and(eq(offers.empresaId, active.empresa.id), eq(offers.status, status)))
      .orderBy(desc(offers.sentAt));

    return c.json({
      offers: rows.map((r) => ({
        id: r.offer.id,
        status: r.offer.status,
        score: r.offer.score / 1000,
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
    if (!active.empresa.isTransportista) {
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
            trip_request_id: result.assignment.tripId,
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
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.toLowerCase().includes('unique') || errMsg.toLowerCase().includes('duplicate')) {
        opts.logger.warn({ err, offerId }, 'race condition: trip already assigned');
        return c.json({ error: 'trip_already_assigned', code: 'trip_already_assigned' }, 409);
      }
      opts.logger.error({ err, offerId }, 'unexpected error in /offers/:id/accept');
      throw err;
    }
  });

  // GET /offers/:id/eco-preview — Phase 1 PR-H3
  // Devuelve la huella de carbono estimada de la oferta (pre-accept).
  // Usa Routes API si está configurado; si no, fallback a tabla Chile.
  app.get('/:id/eco-preview', async (c) => {
    const userContext = c.get('userContext');
    if (!userContext) {
      return c.json({ error: 'internal_server_error' }, 500);
    }
    const active = userContext.activeMembership;
    if (!active) {
      return c.json({ error: 'no_active_empresa', code: 'no_active_empresa' }, 403);
    }
    if (!active.empresa.isTransportista) {
      return c.json({ error: 'not_a_carrier', code: 'not_a_carrier' }, 403);
    }

    const offerId = c.req.param('id');

    try {
      const preview = await generarEcoPreview({
        db: opts.db,
        logger: opts.logger,
        offerId,
        empresaId: active.empresa.id,
        routesApiKey: config.GOOGLE_ROUTES_API_KEY,
      });
      return c.json({
        trip_request_id: preview.tripId,
        suggested_vehicle_id: preview.suggestedVehicleId,
        distance_km: preview.distanceKm,
        duration_s: preview.durationS,
        fuel_liters_estimated: preview.fuelLitersEstimated,
        emisiones_kgco2e_wtw: preview.emisionesKgco2eWtw,
        emisiones_kgco2e_ttw: preview.emisionesKgco2eTtw,
        emisiones_kgco2e_wtt: preview.emisionesKgco2eWtt,
        intensidad_gco2e_por_tonkm: preview.intensidadGco2ePorTonKm,
        precision_method: preview.precisionMethod,
        data_source: preview.dataSource,
        glec_version: preview.glecVersion,
        generated_at: preview.generatedAt,
      });
    } catch (err) {
      if (err instanceof OfferNotFoundForPreviewError) {
        return c.json({ error: 'offer_not_found', code: 'offer_not_found' }, 404);
      }
      if (err instanceof OfferForbiddenForPreviewError) {
        return c.json({ error: 'offer_forbidden', code: 'offer_forbidden' }, 403);
      }
      opts.logger.error({ err, offerId }, 'unexpected error in /offers/:id/eco-preview');
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
    if (!active.empresa.isTransportista) {
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
