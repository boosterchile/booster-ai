import type { Logger } from '@booster-ai/logger';
import { tripRequestCreateInputSchema } from '@booster-ai/shared-schemas';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import type { Db } from '../db/client.js';
import { tripRequests } from '../db/schema.js';
import { TripRequestNotFoundError, runMatching } from '../services/matching.js';

/**
 * Endpoint canónico para que un shipper autenticado cree un trip_request
 * y dispare matching automático.
 *
 * NOTA: Este es el flow web/api oficial (post B.5). El bot WhatsApp legacy
 * sigue usando `whatsapp_intake_drafts` + `/trip-requests` (legacy
 * router montado en `routes/trip-requests.ts`). Cuando migremos el bot
 * para que use empresa-aware schemas, podremos consolidar.
 *
 * Por eso este file se llama `trip-requests-v2.ts` y se monta en
 * `/trip-requests-v2` para no chocar con el legacy. Slice posterior puede
 * promover este a `/trip-requests` y mover el legacy a deprecated.
 *
 * Requisitos:
 *   - firebaseAuth + userContext middlewares (activeMembership presente).
 *   - activeMembership.empresa.is_shipper=true (sino 403 not_a_shipper).
 *   - empresa.status='active' (sino 403 empresa_not_active).
 */
function generateTrackingCode(): string {
  // Boo + 6 chars alphanumeric uppercase. Match con el patrón legacy del
  // bot (BOO-M6LO3H formato). Slice futuro: usar nanoid o ULID + checksum.
  const alphabet = 'ABCDEFGHIJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 6; i += 1) {
    suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `BOO-${suffix}`;
}

export function createTripRequestsV2Routes(opts: { db: Db; logger: Logger }) {
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
    if (!active.empresa.isShipper) {
      return c.json({ error: 'not_a_shipper', code: 'not_a_shipper' }, 403);
    }
    if (active.empresa.status !== 'active') {
      return c.json({ error: 'empresa_not_active', code: 'empresa_not_active' }, 403);
    }

    const input = c.req.valid('json');

    // Crear trip_request en transacción separada del matching para que el
    // POST devuelva rápido aunque matching tarde un poco. Slice futuro:
    // matching en un job/queue async.
    const [trip] = await opts.db
      .insert(tripRequests)
      .values({
        trackingCode: generateTrackingCode(),
        shipperEmpresaId: active.empresa.id,
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
        status: 'pending_match',
      })
      .returning();

    if (!trip) {
      opts.logger.error('insert trip_request returned no row');
      return c.json({ error: 'internal_server_error' }, 500);
    }

    opts.logger.info(
      {
        tripRequestId: trip.id,
        trackingCode: trip.trackingCode,
        shipperEmpresaId: trip.shipperEmpresaId,
        cargoType: trip.cargoType,
        originRegion: trip.originRegionCode,
      },
      'trip_request created',
    );

    // Disparar matching inline. Errors no bloquean la respuesta — el trip
    // queda en `pending_match` y un job posterior puede reintentar.
    let matchingResult: Awaited<ReturnType<typeof runMatching>> | null = null;
    try {
      matchingResult = await runMatching({
        db: opts.db,
        logger: opts.logger,
        tripRequestId: trip.id,
      });
    } catch (err) {
      if (err instanceof TripRequestNotFoundError) {
        // No debería ocurrir — acabamos de crear el trip. Race condition
        // teórica si alguien borra antes del matching. Ignorar.
        opts.logger.warn({ err, tripRequestId: trip.id }, 'matching: trip vanished');
      } else {
        opts.logger.error({ err, tripRequestId: trip.id }, 'matching threw, leaving trip pending');
      }
    }

    return c.json(
      {
        trip_request: {
          id: trip.id,
          tracking_code: trip.trackingCode,
          status: matchingResult
            ? matchingResult.offersCreated > 0
              ? 'offers_sent'
              : 'expired'
            : 'pending_match',
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
