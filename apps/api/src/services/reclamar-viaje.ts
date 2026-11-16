import type { Logger } from '@booster-ai/logger';
import { esAceptableOferta, esEstadoViaje } from '@booster-ai/trip-state-machine';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { empresas, offers, trips, zones } from '../db/schema.js';
import { setResultAttributes, withBusinessSpan } from '../observability/business-span.js';
import type { NotifyTrackingLinkEmailDeps } from './notify-tracking-link-email.js';
import type { NotifyTrackingLinkDeps } from './notify-tracking-link.js';
import { type AcceptOfferResult, TripNotAcceptableError, acceptOffer } from './offer-actions.js';

/** El viaje no admite reclamo (estado, ya asignado, etc.). */
export class ViajeNoReclamableError extends Error {
  constructor(
    public readonly tripId: string,
    public readonly reason: string,
  ) {
    super(`Viaje ${tripId} no reclamable: ${reason}`);
    this.name = 'ViajeNoReclamableError';
  }
}

/** La empresa no tiene zona de recogida en la región de origen. */
export class ZonaNoCubreError extends Error {
  constructor(
    public readonly tripId: string,
    public readonly empresaId: string,
  ) {
    super(`Empresa ${empresaId} sin zona de recogida para el viaje ${tripId}`);
    this.name = 'ZonaNoCubreError';
  }
}

export class EmpresaNoTransportistaError extends Error {
  constructor(public readonly empresaId: string) {
    super(`Empresa ${empresaId} no es transportista activa`);
    this.name = 'EmpresaNoTransportistaError';
  }
}

export interface ReclamarViajeOptions {
  db: Db;
  logger: Logger;
  tripId: string;
  empresaId: string;
  userId: string;
  notifyTrackingLink?: NotifyTrackingLinkDeps;
  notifyTrackingLinkEmail?: NotifyTrackingLinkEmailDeps;
}

export type ReclamarViajeResult = AcceptOfferResult & { origen: 'reclamo' };

/**
 * BARH-23: reclama un viaje en `ofertas_enviadas` sin oferta propia.
 * Crea oferta sintética si hace falta y reutiliza `acceptOffer`.
 * No relaja elegibilidad de flota al despachar.
 */
export async function reclamarViaje(opts: ReclamarViajeOptions): Promise<ReclamarViajeResult> {
  return await withBusinessSpan(
    {
      name: 'viaje.reclamar',
      attributes: {
        'booster.trip_id': opts.tripId,
        'booster.empresa_id': opts.empresaId,
        'booster.user_id': opts.userId,
      },
    },
    async (span) => {
      const result = await reclamarViajeInner(opts);
      setResultAttributes(span, {
        'booster.assignment_id': result.assignment.id,
        'booster.offer_id': result.offer.id,
        'booster.offer.superseded_count': result.supersededOfferIds.length,
      });
      return result;
    },
  );
}

async function reclamarViajeInner(opts: ReclamarViajeOptions): Promise<ReclamarViajeResult> {
  const { db, logger, tripId, empresaId, userId } = opts;

  const empresaRows = await db
    .select({
      id: empresas.id,
      isTransportista: empresas.isTransportista,
      status: empresas.status,
    })
    .from(empresas)
    .where(eq(empresas.id, empresaId))
    .limit(1);
  const empresa = empresaRows[0];
  if (!empresa || !empresa.isTransportista || empresa.status !== 'activa') {
    throw new EmpresaNoTransportistaError(empresaId);
  }

  const tripRows = await db
    .select({
      id: trips.id,
      status: trips.status,
      originRegionCode: trips.originRegionCode,
    })
    .from(trips)
    .where(eq(trips.id, tripId))
    .limit(1);
  const trip = tripRows[0];
  if (!trip) {
    throw new ViajeNoReclamableError(tripId, 'missing');
  }
  if (!esEstadoViaje(trip.status) || !esAceptableOferta(trip.status)) {
    throw new ViajeNoReclamableError(tripId, trip.status);
  }
  if (!trip.originRegionCode) {
    throw new ViajeNoReclamableError(tripId, 'sin_region_origen');
  }

  const zonaRows = await db
    .select({ empresaId: zones.empresaId })
    .from(zones)
    .where(
      and(
        eq(zones.empresaId, empresaId),
        eq(zones.regionCode, trip.originRegionCode),
        inArray(zones.zoneType, ['recogida', 'ambos']),
        eq(zones.isActive, true),
      ),
    )
    .limit(1);
  if (!zonaRows[0]) {
    throw new ZonaNoCubreError(tripId, empresaId);
  }

  const ofertaPropia = (
    await db
      .select({ id: offers.id, status: offers.status, expiresAt: offers.expiresAt })
      .from(offers)
      .where(
        and(
          eq(offers.tripId, tripId),
          eq(offers.empresaId, empresaId),
          eq(offers.status, 'pendiente'),
        ),
      )
      .limit(1)
  )[0];

  let offerId = ofertaPropia?.id;
  if (!offerId) {
    const precioRef = (
      await db
        .select({ proposedPriceClp: offers.proposedPriceClp })
        .from(offers)
        .where(and(eq(offers.tripId, tripId), eq(offers.status, 'pendiente')))
        .limit(1)
    )[0];
    const proposedPriceClp = precioRef?.proposedPriceClp ?? 0;
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const [creada] = await db
      .insert(offers)
      .values({
        tripId,
        empresaId,
        suggestedVehicleId: null,
        score: 0,
        proposedPriceClp,
        expiresAt,
      })
      .returning({ id: offers.id });
    if (!creada) {
      throw new Error('Insert oferta de reclamo sin fila');
    }
    offerId = creada.id;
    logger.info(
      { tripId, empresaId, offerId, proposedPriceClp, origen: 'reclamo' },
      'oferta sintética creada para reclamo de carga',
    );
  }

  let accepted: AcceptOfferResult;
  try {
    accepted = await acceptOffer({
      db,
      logger,
      offerId,
      empresaId,
      userId,
      ...(opts.notifyTrackingLink ? { notifyTrackingLink: opts.notifyTrackingLink } : {}),
      ...(opts.notifyTrackingLinkEmail
        ? { notifyTrackingLinkEmail: opts.notifyTrackingLinkEmail }
        : {}),
    });
  } catch (err) {
    if (err instanceof TripNotAcceptableError) {
      throw new ViajeNoReclamableError(tripId, err.tripStatus);
    }
    throw err;
  }

  logger.info(
    {
      tripId,
      empresaId,
      userId,
      offerId: accepted.offer.id,
      assignmentId: accepted.assignment.id,
      origen: 'reclamo',
    },
    'viaje reclamado sin oferta previa de matching',
  );

  return { ...accepted, origen: 'reclamo' };
}
