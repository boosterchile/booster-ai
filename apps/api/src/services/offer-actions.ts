import { randomUUID } from 'node:crypto';
import type { Logger } from '@booster-ai/logger';
import { and, eq, ne } from 'drizzle-orm';
import { config } from '../config.js';
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
import {
  type NotifyTrackingLinkDeps,
  notifyTrackingLinkAtAssignment,
} from './notify-tracking-link.js';
import { persistEcoRoutePolyline } from './persist-eco-route-polyline.js';

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
  /**
   * Phase 5 PR-L3 — Deps para enviar el link público de tracking al
   * shipper post-commit fire-and-forget. Si undefined, no se intenta
   * el envío (dev local, tests).
   */
  notifyTrackingLink?: NotifyTrackingLinkDeps;
}): Promise<AcceptOfferResult> {
  const { db, logger, offerId, empresaId, userId, notifyTrackingLink } = opts;

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
      // Phase 5 PR-L1 — generamos `publicTrackingToken` UUID v4 al insert
      // para habilitar el tracking público del consignee/shipper sin auth
      // (futuro WhatsApp template + página /tracking/:token).
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
          publicTrackingToken: randomUUID(),
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
          // ADR-028 PR-H2: si hay GOOGLE_ROUTES_API_KEY, calcularMetricas
          // usa Routes API para distancia (más precisa, traffic-aware) en
          // vez de la tabla pre-computada Chile. Si no hay key (dev sin
          // quota), cae al fallback automáticamente.
          routesApiKey: config.GOOGLE_ROUTES_API_KEY,
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

      // Phase 5 PR-L3 — enviar link público de tracking al shipper.
      // Fire-and-forget: si Twilio falla, el accept de oferta ya está
      // commiteado y no lo revertimos. Skip silencioso si Meta aún no
      // aprobó el template (Content SID con placeholder ROTATE_ME).
      if (notifyTrackingLink) {
        try {
          await notifyTrackingLinkAtAssignment(notifyTrackingLink, {
            assignmentId: result.assignment.id,
          });
        } catch (err) {
          logger.error(
            { err, assignmentId: result.assignment.id },
            'fallo despachar tracking link tras accept (sin impacto en assignment)',
          );
        }
      }

      // Phase 1 PR-H5b — capturar y persistir polyline eco-ruta para que
      // GET /assignments/:id/eco-route sirva el polyline desde DB sin
      // re-fetch a Routes API en cada visita del driver. Fire-and-forget:
      // si Routes API falla acá, el assignment queda con
      // eco_route_polyline_encoded=null y el endpoint hace fallback live.
      try {
        await persistEcoRoutePolyline({
          db,
          logger,
          assignmentId: result.assignment.id,
          ...(config.GOOGLE_ROUTES_API_KEY ? { routesApiKey: config.GOOGLE_ROUTES_API_KEY } : {}),
        });
      } catch (err) {
        logger.error(
          { err, assignmentId: result.assignment.id },
          'fallo persistir eco-route polyline tras accept (sin impacto en assignment)',
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
