import type { Logger } from '@booster-ai/logger';
import {
  type NotifyOfferResult,
  buildOfferTemplateVariables,
} from '@booster-ai/notification-fan-out';
import type { TwilioWhatsAppClient } from '@booster-ai/whatsapp-client';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { empresas, memberships, offers, trips, users } from '../db/schema.js';
import { setResultAttributes, withBusinessSpan } from '../observability/business-span.js';
import { pickOperationalWhatsappRecipients } from './pick-whatsapp-recipients.js';

/**
 * Configuración del dispatcher de notificaciones de oferta.
 *
 * Inyectada desde main.ts — null si las vars Twilio o el ContentSid no
 * están seteados, en cuyo caso `notifyOfferToCarrier` no-op con warn.
 *
 * El package `@booster-ai/notification-fan-out` provee los formatters
 * puros (regionLabel, formatPriceClp, buildOfferTemplateVariables) y los
 * tipos de contrato. Acá orquestamos las queries Drizzle.
 */
export interface NotifyOfferDeps {
  db: Db;
  logger: Logger;
  twilioClient: TwilioWhatsAppClient | null;
  contentSidOfferNew: string | null;
  webAppUrl: string;
}

export type { NotifyOfferResult } from '@booster-ai/notification-fan-out';

export async function notifyOfferToCarrier(
  deps: NotifyOfferDeps,
  opts: { offerId: string },
): Promise<NotifyOfferResult> {
  return await withBusinessSpan(
    {
      name: 'notification.notify_offer',
      attributes: { 'booster.offer_id': opts.offerId },
    },
    async (span) => {
      const result = await notifyOfferToCarrierInner(deps, opts);
      setResultAttributes(span, {
        'booster.notification.skipped': result.skipped,
        'booster.notification.reason': result.reason ?? undefined,
        'booster.notification.sent': result.twilioMessageSid !== undefined,
      });
      return result;
    },
  );
}

async function notifyOfferToCarrierInner(
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

  // 1. Cargar offer + trip + empresa transportista en un solo round-trip.
  const offerRows = await db
    .select({
      offer: offers,
      trip: trips,
      empresa: empresas,
    })
    .from(offers)
    .innerJoin(trips, eq(trips.id, offers.tripId))
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

  // 2. Despachadores activos con WhatsApp. Si no hay, los dueños.
  const memberRows = await db
    .select({
      userId: users.id,
      role: memberships.role,
      whatsappE164: users.whatsappE164,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.empresaId, row.empresa.id),
        inArray(memberships.role, ['despachador', 'dueno']),
        eq(memberships.status, 'activa'),
      ),
    )
    .limit(20);

  const recipients = pickOperationalWhatsappRecipients(memberRows);
  if (recipients.length === 0) {
    const reason = memberRows.length === 0 ? 'no_owner' : 'no_whatsapp';
    logger.warn(
      { offerId, empresaId: row.empresa.id, reason },
      'notifyOfferToCarrier: sin destinatario de WhatsApp',
    );
    return { offerId, skipped: true, reason };
  }

  // 3. Render variables del template usando el helper del package.
  const variables = buildOfferTemplateVariables({
    trackingCode: row.trip.trackingCode,
    originRegionCode: row.trip.originRegionCode,
    destinationRegionCode: row.trip.destinationRegionCode,
    proposedPriceClp: row.offer.proposedPriceClp,
    webAppUrl,
  });

  // 4. Un envío por número. El sid que devolvemos es el primero.
  let responseSid = '';
  for (const recipient of recipients) {
    const response = await twilioClient.sendContent({
      to: recipient.whatsappE164,
      contentSid: contentSidOfferNew,
      contentVariables: variables,
    });
    if (!responseSid) {
      responseSid = response.sid;
    }
  }
  const response = { sid: responseSid };

  // 5. Marcar notificado_en con guard isNull para no pisar concurrentes.
  await db
    .update(offers)
    .set({ notifiedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(offers.id, offerId), isNull(offers.notifiedAt)));

  logger.info(
    {
      offerId,
      recipientUserIds: recipients.map((recipient) => recipient.userId),
      empresaId: row.empresa.id,
      trackingCode: row.trip.trackingCode,
      twilioSid: response.sid,
    },
    'notifyOfferToCarrier sent',
  );

  return { offerId, skipped: false, twilioMessageSid: response.sid };
}
