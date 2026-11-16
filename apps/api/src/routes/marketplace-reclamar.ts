import type { Logger } from '@booster-ai/logger';
import { and, eq, inArray, notExists, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { denegarAceptarOferta } from '../auth/capacidades.js';
import type { Db } from '../db/client.js';
import { offers, trips, zones } from '../db/schema.js';
import type { NotifyTrackingLinkEmailDeps } from '../services/notify-tracking-link-email.js';
import type { NotifyTrackingLinkDeps } from '../services/notify-tracking-link.js';
import {
  OfferExpiredError,
  OfferNotFoundError,
  OfferNotOwnedError,
  OfferNotPendingError,
  TripNotAcceptableError,
} from '../services/offer-actions.js';
import {
  EmpresaNoTransportistaError,
  ViajeNoReclamableError,
  ZonaNoCubreError,
  reclamarViaje,
} from '../services/reclamar-viaje.js';

/**
 * BARH-23 — marketplace: listar viajes reclamables y reclamar.
 *
 *   GET  /marketplace/viajes-abiertos
 *   POST /marketplace/viajes/:viajeId/reclamar
 */
export function createMarketplaceReclamarRoutes(opts: {
  db: Db;
  logger: Logger;
  notifyTrackingLink?: NotifyTrackingLinkDeps;
  notifyTrackingLinkEmail?: NotifyTrackingLinkEmailDeps;
}) {
  const app = new Hono();

  app.get('/viajes-abiertos', async (c) => {
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
    const sinOferta = denegarAceptarOferta(c, userContext);
    if (sinOferta) {
      return sinOferta;
    }

    const empresaId = active.empresa.id;
    const regiones = await opts.db
      .select({ regionCode: zones.regionCode })
      .from(zones)
      .where(
        and(
          eq(zones.empresaId, empresaId),
          inArray(zones.zoneType, ['recogida', 'ambos']),
          eq(zones.isActive, true),
        ),
      );
    const regionCodes = [...new Set(regiones.map((r) => r.regionCode))];
    if (regionCodes.length === 0) {
      return c.json({ viajes: [] });
    }

    const ofertaPropiaPendiente = opts.db
      .select({ id: offers.id })
      .from(offers)
      .where(
        and(
          eq(offers.tripId, trips.id),
          eq(offers.empresaId, empresaId),
          eq(offers.status, 'pendiente'),
        ),
      );

    const rows = await opts.db
      .select({
        id: trips.id,
        trackingCode: trips.trackingCode,
        status: trips.status,
        originAddressRaw: trips.originAddressRaw,
        originRegionCode: trips.originRegionCode,
        destinationAddressRaw: trips.destinationAddressRaw,
        destinationRegionCode: trips.destinationRegionCode,
        cargoType: trips.cargoType,
        cargoWeightKg: trips.cargoWeightKg,
        pickupWindowStart: trips.pickupWindowStart,
        pickupWindowEnd: trips.pickupWindowEnd,
      })
      .from(trips)
      .where(
        and(
          eq(trips.status, 'ofertas_enviadas'),
          inArray(trips.originRegionCode, regionCodes),
          notExists(ofertaPropiaPendiente),
        ),
      )
      .orderBy(sql`${trips.createdAt} desc`)
      .limit(100);

    return c.json({
      viajes: rows.map((t) => ({
        id: t.id,
        tracking_code: t.trackingCode,
        status: t.status,
        origin_address_raw: t.originAddressRaw,
        origin_region_code: t.originRegionCode,
        destination_address_raw: t.destinationAddressRaw,
        destination_region_code: t.destinationRegionCode,
        cargo_type: t.cargoType,
        cargo_weight_kg: t.cargoWeightKg,
        pickup_window_start: t.pickupWindowStart,
        pickup_window_end: t.pickupWindowEnd,
      })),
    });
  });

  app.post('/viajes/:viajeId/reclamar', async (c) => {
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
    const sinOferta = denegarAceptarOferta(c, userContext);
    if (sinOferta) {
      return sinOferta;
    }

    const viajeId = c.req.param('viajeId');
    try {
      const result = await reclamarViaje({
        db: opts.db,
        logger: opts.logger,
        tripId: viajeId,
        empresaId: active.empresa.id,
        userId: userContext.user.id,
        ...(opts.notifyTrackingLink ? { notifyTrackingLink: opts.notifyTrackingLink } : {}),
        ...(opts.notifyTrackingLinkEmail
          ? { notifyTrackingLinkEmail: opts.notifyTrackingLinkEmail }
          : {}),
      });
      return c.json(
        {
          origen: result.origen,
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
      if (err instanceof ViajeNoReclamableError) {
        if (err.reason === 'asignado' || err.reason === 'status_changed_concurrently') {
          return c.json({ error: 'trip_already_assigned', code: 'trip_already_assigned' }, 409);
        }
        if (err.reason === 'missing') {
          return c.json({ error: 'trip_not_found', code: 'trip_not_found' }, 404);
        }
        return c.json(
          { error: 'trip_not_claimable', code: 'trip_not_claimable', reason: err.reason },
          409,
        );
      }
      if (err instanceof ZonaNoCubreError) {
        return c.json({ error: 'zone_not_covered', code: 'zone_not_covered' }, 403);
      }
      if (err instanceof EmpresaNoTransportistaError) {
        return c.json({ error: 'not_a_carrier', code: 'not_a_carrier' }, 403);
      }
      if (err instanceof OfferNotFoundError) {
        return c.json({ error: 'offer_not_found', code: 'offer_not_found' }, 404);
      }
      if (err instanceof OfferNotOwnedError) {
        return c.json({ error: 'offer_forbidden', code: 'offer_forbidden' }, 403);
      }
      if (err instanceof OfferNotPendingError) {
        return c.json({ error: 'offer_not_pending', code: 'offer_not_pending' }, 409);
      }
      if (err instanceof OfferExpiredError) {
        return c.json({ error: 'offer_expired', code: 'offer_expired' }, 409);
      }
      if (err instanceof TripNotAcceptableError) {
        if (err.tripStatus === 'asignado') {
          return c.json({ error: 'trip_already_assigned', code: 'trip_already_assigned' }, 409);
        }
        return c.json(
          {
            error: 'trip_not_acceptable',
            code: 'trip_not_acceptable',
            trip_status: err.tripStatus,
          },
          409,
        );
      }
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.toLowerCase().includes('unique') || errMsg.toLowerCase().includes('duplicate')) {
        opts.logger.warn({ err, viajeId }, 'race: viaje ya asignado en reclamo');
        return c.json({ error: 'trip_already_assigned', code: 'trip_already_assigned' }, 409);
      }
      opts.logger.error({ err, viajeId }, 'unexpected error in /marketplace/viajes/:id/reclamar');
      throw err;
    }
  });

  return app;
}
