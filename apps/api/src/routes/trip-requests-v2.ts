import type { Logger } from '@booster-ai/logger';
import { tripRequestCreateInputSchema } from '@booster-ai/shared-schemas';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import type { Db } from '../db/client.js';
import { trips } from '../db/schema.js';
import { TripRequestNotFoundError, runMatching } from '../services/matching.js';
import type { NotifyOfferDeps } from '../services/notify-offer.js';

/**
 * Endpoint canónico para que un generador de carga autenticado cree un
 * viaje y dispare matching automático.
 *
 * URL `/trip-requests-v2` se mantiene por compat con el cliente web
 * actual; internamente la tabla es `viajes`.
 *
 * Requisitos:
 *   - firebaseAuth + userContext middlewares (activeMembership presente).
 *   - activeMembership.empresa.es_generador_carga=true (sino 403).
 *   - empresa.estado='activa' (sino 403).
 */
function generateTrackingCode(): string {
  const alphabet = 'ABCDEFGHIJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 6; i += 1) {
    suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `BOO-${suffix}`;
}

export function createTripRequestsV2Routes(opts: {
  db: Db;
  logger: Logger;
  notify?: NotifyOfferDeps;
}) {
  const app = new Hono();

  app.post('/', zValidator('json', tripRequestCreateInputSchema), async (c) => {
    const userContext = c.get('userContext');
    if (!userContext) {
      opts.logger.error({ path: c.req.path }, '/trip-requests-v2 without userContext');
      return c.json({ error: 'internal_server_error' }, 500);
    }

    const active = userContext.activeMembership;
    if (!active) {
      return c.json({ error: 'no_active_empresa', code: 'no_active_empresa' }, 403);
    }
    if (!active.empresa.isGeneradorCarga) {
      return c.json({ error: 'not_a_shipper', code: 'not_a_shipper' }, 403);
    }
    if (active.empresa.status !== 'activa') {
      return c.json({ error: 'empresa_not_active', code: 'empresa_not_active' }, 403);
    }

    const input = c.req.valid('json');

    const [trip] = await opts.db
      .insert(trips)
      .values({
        trackingCode: generateTrackingCode(),
        generadorCargaEmpresaId: active.empresa.id,
        createdByUserId: userContext.user.id,
        originAddressRaw: input.origin.address_raw,
        originRegionCode: input.origin.region_code,
        ...(input.origin.comuna_code ? { originComunaCode: input.origin.comuna_code } : {}),
        destinationAddressRaw: input.destination.address_raw,
        destinationRegionCode: input.destination.region_code,
        ...(input.destination.comuna_code
          ? { destinationComunaCode: input.destination.comuna_code }
          : {}),
        cargoType: input.cargo.cargo_type,
        cargoWeightKg: input.cargo.weight_kg,
        ...(input.cargo.volume_m3 ? { cargoVolumeM3: input.cargo.volume_m3 } : {}),
        ...(input.cargo.description ? { cargoDescription: input.cargo.description } : {}),
        pickupDateRaw: `${input.pickup_window.start_at} → ${input.pickup_window.end_at}`,
        pickupWindowStart: new Date(input.pickup_window.start_at),
        pickupWindowEnd: new Date(input.pickup_window.end_at),
        ...(input.proposed_price_clp !== null
          ? { proposedPriceClp: input.proposed_price_clp }
          : {}),
        status: 'esperando_match',
      })
      .returning();

    if (!trip) {
      opts.logger.error('insert trip returned no row');
      return c.json({ error: 'internal_server_error' }, 500);
    }

    opts.logger.info(
      {
        tripId: trip.id,
        trackingCode: trip.trackingCode,
        generadorCargaEmpresaId: trip.generadorCargaEmpresaId,
        cargoType: trip.cargoType,
        originRegion: trip.originRegionCode,
      },
      'trip created',
    );

    let matchingResult: Awaited<ReturnType<typeof runMatching>> | null = null;
    try {
      matchingResult = await runMatching({
        db: opts.db,
        logger: opts.logger,
        tripId: trip.id,
        ...(opts.notify ? { notify: opts.notify } : {}),
      });
    } catch (err) {
      if (err instanceof TripRequestNotFoundError) {
        opts.logger.warn({ err, tripId: trip.id }, 'matching: trip vanished');
      } else {
        opts.logger.error({ err, tripId: trip.id }, 'matching threw, leaving trip pending');
      }
    }

    return c.json(
      {
        trip_request: {
          id: trip.id,
          tracking_code: trip.trackingCode,
          status: matchingResult
            ? matchingResult.offersCreated > 0
              ? 'ofertas_enviadas'
              : 'expirado'
            : 'esperando_match',
        },
        matching: matchingResult
          ? {
              candidates_evaluated: matchingResult.candidatesEvaluated,
              offers_created: matchingResult.offersCreated,
              offer_ids: matchingResult.offers.map((o) => o.id),
            }
          : null,
      },
      201,
    );
  });

  return app;
}
