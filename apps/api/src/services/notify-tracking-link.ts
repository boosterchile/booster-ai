/**
 * Despacha el link público de tracking al shipper cuando se acepta una
 * oferta y se crea la assignment (Phase 5 PR-L3).
 *
 * El generador de carga recibe vía WhatsApp:
 *   - Confirmación de que su carga ya tiene transportista
 *   - Resumen de ruta (origen → destino)
 *   - Botón "Ver seguimiento" → https://app.boosterchile.com/tracking/<token>
 *
 * **Recipient resolution** (Phase 5 PR-L3b):
 *   El generador (createdByUserId) recibe la confirmación en su
 *   whatsapp_e164. Si la carga tiene destinatario_whatsapp_e164 y es
 *   otro número, esa persona también recibe el link. El mismo número
 *   recibe un solo mensaje.
 *
 *   Esta política se reporta en el resultado vía `recipient` para
 *   audit/analytics.
 *
 * **Idempotencia**: igual que notify-offer.ts, marcar via columna
 * `tracking_link_enviado_en` en assignments. Mismo patrón anti-spam:
 * si la mutation se reintenta o el dispatcher fire-and-forget se
 * dispara dos veces, sólo se envía una vez.
 *
 * **Skip silencioso** (NO error) si:
 *   - Twilio o Content SID ausentes (Meta sin aprobar todavía)
 *   - Assignment no existe (race con eliminación)
 *   - Trip sin shipper user con whatsapp_e164
 *   - Ya se envió antes
 *
 * Llamado fire-and-forget desde `offer-actions.ts` post-tx. NUNCA throw
 * — un fallo en delivery WhatsApp NO debe revertir la aceptación de
 * la oferta.
 */

import type { Logger } from '@booster-ai/logger';
import {
  type NotifyTrackingLinkResult,
  buildTrackingLinkVariables,
} from '@booster-ai/notification-fan-out';
import type { TwilioWhatsAppClient } from '@booster-ai/whatsapp-client';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { assignments, trips, users } from '../db/schema.js';

export type { NotifyTrackingLinkResult };

export interface NotifyTrackingLinkDeps {
  db: Db;
  logger: Logger;
  /** Cliente Twilio. null en dev sin envs. */
  twilioClient: TwilioWhatsAppClient | null;
  /** Content SID del template `tracking_link_v1`. null si pendiente Meta. */
  contentSidTracking: string | null;
}

export async function notifyTrackingLinkAtAssignment(
  deps: NotifyTrackingLinkDeps,
  opts: { assignmentId: string },
): Promise<NotifyTrackingLinkResult> {
  const { db, logger, twilioClient, contentSidTracking } = deps;
  const { assignmentId } = opts;

  if (twilioClient === null || contentSidTracking === null) {
    logger.warn(
      {
        assignmentId,
        hasTwilio: twilioClient !== null,
        hasContentSid: contentSidTracking !== null,
      },
      'notifyTrackingLinkAtAssignment skipped — Twilio o Content SID tracking ausente',
    );
    return { assignmentId, skipped: true, reason: 'not_configured' };
  }

  // Cargar assignment + trip + shipper user en un solo round-trip.
  // El shipper user es `trips.createdByUserId` (quien creó la carga).
  // El consignee phone (opt-in) viene de trips directamente.
  const rows = await db
    .select({
      assignmentId: assignments.id,
      publicToken: assignments.publicTrackingToken,
      trackingCode: trips.trackingCode,
      originRegion: trips.originRegionCode,
      destRegion: trips.destinationRegionCode,
      consigneeWhatsapp: trips.consigneeWhatsappE164,
      shipperUserId: trips.createdByUserId,
      shipperWhatsapp: users.whatsappE164,
    })
    // rls-allowlist: notificador server-side, destinatario derivado del assignmentId ya validado (censo §2(3))
    .from(assignments)
    .innerJoin(trips, eq(trips.id, assignments.tripId))
    .leftJoin(users, eq(users.id, trips.createdByUserId))
    .where(eq(assignments.id, assignmentId))
    .limit(1);

  const row = rows[0];
  if (!row) {
    logger.warn({ assignmentId }, 'notifyTrackingLinkAtAssignment: assignment not found');
    return { assignmentId, skipped: true, reason: 'assignment_not_found' };
  }

  if (!row.publicToken) {
    // Assignment pre-Phase-5 sin token. Skip — no podemos generar el link.
    logger.info(
      { assignmentId },
      'notifyTrackingLinkAtAssignment skipped — assignment sin publicTrackingToken (pre-Phase-5)',
    );
    return { assignmentId, skipped: true, reason: 'no_token' };
  }

  // El generador recibe la confirmación. El destinatario recibe el link
  // solo si dejó un teléfono distinto: un mismo número, un solo mensaje.
  const recipients: { phone: string; role: 'consignee' | 'shipper' }[] = [];
  if (row.shipperWhatsapp) {
    recipients.push({ phone: row.shipperWhatsapp, role: 'shipper' });
  }
  if (row.consigneeWhatsapp && row.consigneeWhatsapp !== row.shipperWhatsapp) {
    recipients.push({ phone: row.consigneeWhatsapp, role: 'consignee' });
  }
  const recipient = recipients.find((item) => item.role === 'consignee') ?? recipients[0] ?? null;

  if (!recipient) {
    if (!row.shipperUserId) {
      logger.info(
        { assignmentId },
        'notifyTrackingLinkAtAssignment skipped — sin consignee phone y trip sin createdByUserId',
      );
      return { assignmentId, skipped: true, reason: 'no_owner' };
    }
    logger.info(
      { assignmentId, shipperUserId: row.shipperUserId },
      'notifyTrackingLinkAtAssignment skipped — sin consignee phone y shipper user sin whatsapp_e164',
    );
    return { assignmentId, skipped: true, reason: 'no_whatsapp' };
  }

  // Construir variables del template usando el helper puro.
  const variables = buildTrackingLinkVariables({
    trackingCode: row.trackingCode,
    originRegionCode: row.originRegion,
    destinationRegionCode: row.destRegion,
    publicTrackingToken: row.publicToken,
  });

  let responseSid = '';
  for (const target of recipients) {
    const sent = await twilioClient.sendContent({
      to: target.phone,
      contentSid: contentSidTracking,
      contentVariables: variables,
    });
    if (!responseSid) {
      responseSid = sent.sid;
    }
  }
  const response = { sid: responseSid };

  logger.info(
    {
      assignmentId,
      recipientRole: recipient.role,
      trackingCode: row.trackingCode,
      twilioSid: response.sid,
    },
    'notifyTrackingLinkAtAssignment sent',
  );

  return {
    assignmentId,
    skipped: false,
    twilioMessageSid: response.sid,
    recipient: recipient.role,
  };
}
