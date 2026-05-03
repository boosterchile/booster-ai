import type { Logger } from '@booster-ai/logger';
import { tripRequestCreateInputSchema } from '@booster-ai/shared-schemas';
import { zValidator } from '@hono/zod-validator';
import { and, asc, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import {
  assignments,
  empresas as empresasTable,
  telemetryPoints,
  tripEvents,
  tripMetrics,
  trips,
  users as usersTable,
  vehicles,
} from '../db/schema.js';
import { TripRequestNotFoundError, runMatching } from '../services/matching.js';
import type { NotifyOfferDeps } from '../services/notify-offer.js';

/**
 * Endpoint canónico para que un generador de carga autenticado:
 *   - cree un viaje (POST /) y dispare matching automático
 *   - liste sus viajes (GET /)
 *   - vea el detalle de uno (GET /:id) con eventos, asignación y métricas
 *   - cancele uno pre-asignación (PATCH /:id/cancelar)
 *
 * URL `/trip-requests-v2` se mantiene por compat con el cliente web actual;
 * internamente la tabla es `viajes`.
 *
 * Multi-tenant: todos los reads y writes filtran por
 * `activeMembership.empresa.id` contra `generadorCargaEmpresaId`. Un shipper
 * jamás ve cargas de otra empresa.
 */
function generateTrackingCode(): string {
  const alphabet = 'ABCDEFGHIJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 6; i += 1) {
    suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `BOO-${suffix}`;
}

// Status pre-asignación: el shipper aún puede cancelar sin involucrar al
// transportista. Una vez `asignado` o posterior, el shipper debería
// coordinar con el transportista (fuera del scope de este endpoint).
const CANCELLABLE_STATUSES = new Set([
  'borrador',
  'esperando_match',
  'emparejando',
  'ofertas_enviadas',
]);

const cancelBodySchema = z.object({
  reason: z.string().min(1).max(500).optional(),
});

export function createTripRequestsV2Routes(opts: {
  db: Db;
  logger: Logger;
  notify?: NotifyOfferDeps;
}) {
  const app = new Hono();

  // biome-ignore lint/suspicious/noExplicitAny: hono Context generics complejos
  function requireShipperAuth(c: Context<any, any, any>, opts2?: { requireActive?: boolean }) {
    const userContext = c.get('userContext');
    if (!userContext) {
      opts.logger.error({ path: c.req.path }, '/trip-requests-v2 without userContext');
      return { ok: false as const, response: c.json({ error: 'unauthorized' }, 401) };
    }
    const active = userContext.activeMembership;
    if (!active) {
      return {
        ok: false as const,
        response: c.json({ error: 'no_active_empresa', code: 'no_active_empresa' }, 403),
      };
    }
    if (!active.empresa.isGeneradorCarga) {
      return {
        ok: false as const,
        response: c.json({ error: 'not_a_shipper', code: 'not_a_shipper' }, 403),
      };
    }
    // status='activa' solo se exige para writes (POST, PATCH cancelar). Para
    // reads (GET listado, GET detalle) permitimos pendiente_verificacion: el
    // shipper puede ver su listado vacío sin chocar con un 403 confuso. Si
    // intenta crear una carga, el guard write-mode lo bloquea.
    if (opts2?.requireActive && active.empresa.status !== 'activa') {
      return {
        ok: false as const,
        response: c.json({ error: 'empresa_not_active', code: 'empresa_not_active' }, 403),
      };
    }
    return { ok: true as const, userContext, activeMembership: active };
  }

  // ---------------------------------------------------------------------
  // POST / — crear viaje + dispatch matching.
  // ---------------------------------------------------------------------
  app.post('/', zValidator('json', tripRequestCreateInputSchema), async (c) => {
    const auth = requireShipperAuth(c, { requireActive: true });
    if (!auth.ok) {
      return auth.response;
    }

    const input = c.req.valid('json');

    const [trip] = await opts.db
      .insert(trips)
      .values({
        trackingCode: generateTrackingCode(),
        generadorCargaEmpresaId: auth.activeMembership.empresa.id,
        createdByUserId: auth.userContext.user.id,
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

  // ---------------------------------------------------------------------
  // GET / — lista de viajes de la empresa shipper activa.
  // ---------------------------------------------------------------------
  app.get('/', async (c) => {
    const auth = requireShipperAuth(c);
    if (!auth.ok) {
      return auth.response;
    }

    const rows = await opts.db
      .select({
        id: trips.id,
        tracking_code: trips.trackingCode,
        status: trips.status,
        origin_address_raw: trips.originAddressRaw,
        origin_region_code: trips.originRegionCode,
        destination_address_raw: trips.destinationAddressRaw,
        destination_region_code: trips.destinationRegionCode,
        cargo_type: trips.cargoType,
        cargo_weight_kg: trips.cargoWeightKg,
        cargo_volume_m3: trips.cargoVolumeM3,
        pickup_window_start: trips.pickupWindowStart,
        pickup_window_end: trips.pickupWindowEnd,
        proposed_price_clp: trips.proposedPriceClp,
        created_at: trips.createdAt,
      })
      .from(trips)
      .where(eq(trips.generadorCargaEmpresaId, auth.activeMembership.empresa.id))
      .orderBy(desc(trips.createdAt));

    return c.json({ trip_requests: rows });
  });

  // ---------------------------------------------------------------------
  // GET /:id — detalle (incluye eventos, asignación, métricas si existen).
  // ---------------------------------------------------------------------
  app.get('/:id', async (c) => {
    const auth = requireShipperAuth(c);
    if (!auth.ok) {
      return auth.response;
    }
    const id = c.req.param('id');
    const empresaId = auth.activeMembership.empresa.id;

    const [trip] = await opts.db
      .select()
      .from(trips)
      .where(and(eq(trips.id, id), eq(trips.generadorCargaEmpresaId, empresaId)))
      .limit(1);

    if (!trip) {
      return c.json({ error: 'trip_not_found' }, 404);
    }

    const events = await opts.db
      .select({
        id: tripEvents.id,
        event_type: tripEvents.eventType,
        source: tripEvents.source,
        payload: tripEvents.payload,
        recorded_at: tripEvents.recordedAt,
      })
      .from(tripEvents)
      .where(eq(tripEvents.tripId, id))
      .orderBy(asc(tripEvents.recordedAt));

    const [assignmentRow] = await opts.db
      .select({
        id: assignments.id,
        status: assignments.status,
        agreed_price_clp: assignments.agreedPriceClp,
        accepted_at: assignments.acceptedAt,
        picked_up_at: assignments.pickedUpAt,
        delivered_at: assignments.deliveredAt,
        cancelled_at: assignments.cancelledAt,
        cancelled_by_actor: assignments.cancelledByActor,
        empresa_id: assignments.empresaId,
        empresa_legal_name: empresasTable.legalName,
        vehicle_id: assignments.vehicleId,
        vehicle_plate: vehicles.plate,
        vehicle_type: vehicles.vehicleType,
        driver_user_id: assignments.driverUserId,
        driver_name: usersTable.fullName,
      })
      .from(assignments)
      .leftJoin(empresasTable, eq(empresasTable.id, assignments.empresaId))
      .leftJoin(vehicles, eq(vehicles.id, assignments.vehicleId))
      .leftJoin(usersTable, eq(usersTable.id, assignments.driverUserId))
      .where(eq(assignments.tripId, id))
      .limit(1);

    const [metricsRow] = await opts.db
      .select()
      .from(tripMetrics)
      .where(eq(tripMetrics.tripId, id))
      .limit(1);

    // Si hay asignación con vehículo, traer última ubicación del vehículo.
    // Permite al shipper saber en tiempo real dónde va su carga sin
    // exponer otros datos del transportista. Si el vehículo no tiene
    // Teltonika asociado o no recibió packets aún, ubicacion_actual es null.
    let ubicacionActual: {
      timestamp_device: Date;
      latitude: number | null;
      longitude: number | null;
      speed_kmh: number | null;
      angle_deg: number | null;
    } | null = null;
    if (assignmentRow?.vehicle_id) {
      const [last] = await opts.db
        .select({
          timestamp_device: telemetryPoints.timestampDevice,
          longitude: telemetryPoints.longitude,
          latitude: telemetryPoints.latitude,
          speed_kmh: telemetryPoints.speedKmh,
          angle_deg: telemetryPoints.angleDeg,
        })
        .from(telemetryPoints)
        .where(eq(telemetryPoints.vehicleId, assignmentRow.vehicle_id))
        .orderBy(desc(telemetryPoints.timestampDevice))
        .limit(1);
      if (last) {
        ubicacionActual = {
          timestamp_device: last.timestamp_device,
          latitude: last.latitude != null ? Number.parseFloat(last.latitude) : null,
          longitude: last.longitude != null ? Number.parseFloat(last.longitude) : null,
          speed_kmh: last.speed_kmh,
          angle_deg: last.angle_deg,
        };
      }
    }

    return c.json({
      trip_request: serializeTripDetail(trip),
      events,
      assignment: assignmentRow
        ? { ...assignmentRow, ubicacion_actual: ubicacionActual }
        : null,
      metrics: metricsRow
        ? {
            distance_km_estimated: metricsRow.distanceKmEstimated,
            distance_km_actual: metricsRow.distanceKmActual,
            carbon_emissions_kgco2e_estimated: metricsRow.carbonEmissionsKgco2eEstimated,
            carbon_emissions_kgco2e_actual: metricsRow.carbonEmissionsKgco2eActual,
            precision_method: metricsRow.precisionMethod,
            glec_version: metricsRow.glecVersion,
            certificate_pdf_url: metricsRow.certificatePdfUrl,
            certificate_issued_at: metricsRow.certificateIssuedAt,
          }
        : null,
    });
  });

  // ---------------------------------------------------------------------
  // PATCH /:id/cancelar — cancel pre-asignación.
  //
  // Solo permite cancelar si status ∈ CANCELLABLE_STATUSES. Una vez
  // `asignado` o posterior, el shipper debe coordinar la cancelación con
  // el transportista (fuera del scope de este endpoint).
  // ---------------------------------------------------------------------
  app.patch('/:id/cancelar', zValidator('json', cancelBodySchema), async (c) => {
    const auth = requireShipperAuth(c, { requireActive: true });
    if (!auth.ok) {
      return auth.response;
    }
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const empresaId = auth.activeMembership.empresa.id;
    const userId = auth.userContext.user.id;

    // Verificar ownership + leer status actual.
    const [trip] = await opts.db
      .select({ id: trips.id, status: trips.status, trackingCode: trips.trackingCode })
      .from(trips)
      .where(and(eq(trips.id, id), eq(trips.generadorCargaEmpresaId, empresaId)))
      .limit(1);

    if (!trip) {
      return c.json({ error: 'trip_not_found' }, 404);
    }

    if (!CANCELLABLE_STATUSES.has(trip.status)) {
      return c.json(
        {
          error: 'trip_not_cancellable',
          code: 'trip_not_cancellable',
          current_status: trip.status,
        },
        409,
      );
    }

    const [updated] = await opts.db
      .update(trips)
      .set({ status: 'cancelado', updatedAt: new Date() })
      .where(and(eq(trips.id, id), eq(trips.generadorCargaEmpresaId, empresaId)))
      .returning();

    if (!updated) {
      return c.json({ error: 'trip_not_found' }, 404);
    }

    await opts.db.insert(tripEvents).values({
      tripId: id,
      eventType: 'cancelado',
      source: 'web',
      recordedByUserId: userId,
      payload: {
        actor: 'generador_carga',
        previous_status: trip.status,
        ...(body.reason ? { reason: body.reason } : {}),
      },
    });

    opts.logger.info(
      {
        tripId: id,
        trackingCode: trip.trackingCode,
        previousStatus: trip.status,
        empresaId,
        userId,
      },
      'trip cancelled by shipper',
    );

    return c.json({
      trip_request: {
        id: updated.id,
        tracking_code: updated.trackingCode,
        status: updated.status,
      },
    });
  });

  return app;
}

function serializeTripDetail(row: typeof trips.$inferSelect) {
  return {
    id: row.id,
    tracking_code: row.trackingCode,
    status: row.status,
    origin_address_raw: row.originAddressRaw,
    origin_region_code: row.originRegionCode,
    origin_comuna_code: row.originComunaCode,
    destination_address_raw: row.destinationAddressRaw,
    destination_region_code: row.destinationRegionCode,
    destination_comuna_code: row.destinationComunaCode,
    cargo_type: row.cargoType,
    cargo_weight_kg: row.cargoWeightKg,
    cargo_volume_m3: row.cargoVolumeM3,
    cargo_description: row.cargoDescription,
    pickup_window_start: row.pickupWindowStart,
    pickup_window_end: row.pickupWindowEnd,
    proposed_price_clp: row.proposedPriceClp,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}
