import type { Logger } from '@booster-ai/logger';
import type { TwilioWhatsAppClient } from '@booster-ai/whatsapp-client';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { empresas, memberships, offers, tripRequests, users } from '../db/schema.js';

/**
 * Configuración del dispatcher de notificaciones de oferta.
 *
 * Inyectada al inicio (main.ts) — null si las vars Twilio o el ContentSid
 * no están seteados, en cuyo caso `notifyOfferToCarrier` no-op con warn.
 */
export interface NotifyOfferDeps {
  db: Db;
  logger: Logger;
  twilioClient: TwilioWhatsAppClient | null;
  contentSidOfferNew: string | null;
  webAppUrl: string;
}

const REGION_LABELS: Record<string, string> = {
  XV: 'Arica',
  I: 'Tarapacá',
  II: 'Antofagasta',
  III: 'Atacama',
  IV: 'Coquimbo',
  V: 'Valparaíso',
  XIII: 'Metropolitana',
  VI: "O'Higgins",
  VII: 'Maule',
  XVI: 'Ñuble',
  VIII: 'Biobío',
  IX: 'Araucanía',
  XIV: 'Los Ríos',
  X: 'Los Lagos',
  XI: 'Aysén',
  XII: 'Magallanes',
};

function formatPriceClp(value: number): string {
  return `$ ${value.toLocaleString('es-CL')} CLP`;
}

function regionLabel(code: string | null): string {
  if (code === null) {
    return '—';
  }
  return REGION_LABELS[code] ?? code;
}

/**
 * Notifica al owner activo de la empresa carrier que llegó una nueva
 * oferta. Diseño:
 *
 *   - Idempotente: si la oferta ya tiene `notified_at` seteado, retorna
 *     `{ skipped: true, reason: 'already_notified' }`.
 *   - Tolerante a config faltante: si twilioClient o contentSid son null,
 *     loguea warn y retorna `{ skipped: true, reason: 'not_configured' }`.
 *   - Tolerante a usuarios sin WhatsApp: si el owner activo no tiene
 *     whatsapp_e164, loguea warn y retorna `{ skipped: true, reason: 'no_whatsapp' }`.
 *     B.8.a hace que sea obligatorio en el onboarding, así que esto solo
 *     debería ocurrir con usuarios legacy pre-B.8.
 *
 * Errores de red/Twilio se propagan al caller. El caller (runMatching)
 * usa Promise.allSettled para que un fallo de una notificación no rompa
 * la creación de offers.
 */
export interface NotifyOfferResult {
  offerId: string;
  skipped: boolean;
  reason?: 'already_notified' | 'not_configured' | 'no_whatsapp' | 'no_owner' | 'offer_not_found';
  twilioMessageSid?: string;
}

export async function notifyOfferToCarrier(
  deps: NotifyOfferDeps,
  opts: { offerId: string },
): Promise<NotifyOfferResult> {
  const { db, logger, twilioClient, contentSidOfferNew, webAppUrl } = deps;
  const { offerId } = opts;

  if (twilioClient === null || contentSidOfferNew === null) {
    logger.warn(
      { offerId, reason: 'twilio_or_content_sid_missing' },
      'notifyOfferToCarrier skipped — config incompleta',
    );
    return { offerId, skipped: true, reason: 'not_configured' };
  }

  // 1. Cargar offer + trip_request + carrier empresa en un solo round-trip.
  const offerRows = await db
    .select({
      offer: offers,
      trip: tripRequests,
      empresa: empresas,
    })
    .from(offers)
    .innerJoin(tripRequests, eq(tripRequests.id, offers.tripRequestId))
    .innerJoin(empresas, eq(empresas.id, offers.empresaId))
    .where(eq(offers.id, offerId))
    .limit(1);

  const row = offerRows[0];
  if (!row) {
    logger.warn({ offerId }, 'notifyOfferToCarrier: offer not found');
    return { offerId, skipped: true, reason: 'offer_not_found' };
  }

  if (row.offer.notifiedAt !== null) {
    return { offerId, skipped: true, reason: 'already_notified' };
  }

  // 2. Encontrar al owner activo del carrier. Si hay varios owners,
  //    notificamos al más antiguo (createdAt asc) para tener determinismo.
  const ownerRows = await db
    .select({ user: users })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.empresaId, row.empresa.id),
        eq(memberships.role, 'owner'),
        eq(memberships.status, 'active'),
      ),
    )
    .orderBy(memberships.createdAt)
    .limit(1);

  const owner = ownerRows[0]?.user;
  if (!owner) {
    logger.warn(
      { offerId, empresaId: row.empresa.id },
      'notifyOfferToCarrier: empresa carrier sin owner activo',
    );
    return { offerId, skipped: true, reason: 'no_owner' };
  }

  if (!owner.whatsappE164) {
    logger.warn(
      { offerId, ownerUserId: owner.id, empresaId: row.empresa.id },
      'notifyOfferToCarrier: owner sin whatsapp_e164 (legacy pre-B.8)',
    );
    return { offerId, skipped: true, reason: 'no_whatsapp' };
  }

  // 3. Render variables del template.
  const route = `${regionLabel(row.trip.originRegionCode)} → ${regionLabel(row.trip.destinationRegionCode)}`;
  const variables: Record<string, string> = {
    '1': row.trip.trackingCode,
    '2': route,
    '3': formatPriceClp(row.offer.proposedPriceClp),
    '4': `${webAppUrl.replace(/\/$/, '')}/app/ofertas`,
  };

  // 4. Disparar el template.
  const response = await twilioClient.sendContent({
    to: owner.whatsappE164,
    contentSid: contentSidOfferNew,
    contentVariables: variables,
  });

  // 5. Marcar notified_at. Usamos WHERE notified_at IS NULL para no pisar
  //    si dos llamadas concurrentes fueron despachadas (improbable pero
  //    seguro).
  await db
    .update(offers)
    .set({ notifiedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(offers.id, offerId), isNull(offers.notifiedAt)));

  logger.info(
    {
      offerId,
      ownerUserId: owner.id,
      empresaId: row.empresa.id,
      trackingCode: row.trip.trackingCode,
      twilioSid: response.sid,
    },
    'notifyOfferToCarrier sent',
  );

  return { offerId, skipped: false, twilioMessageSid: response.sid };
}
