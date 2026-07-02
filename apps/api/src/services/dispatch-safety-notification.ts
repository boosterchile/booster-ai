/**
 * dispatchSafetyNotification — Task 9
 *
 * Envía notificaciones de seguridad física (push + WhatsApp) a los dueños
 * del transportista cuando ocurre un evento safety-p0 (crash/unplug/jamming).
 *
 * Garantías:
 *   - Dedupe por IMEI+eventType con TTL 600s en Redis (SET NX EX).
 *   - Best-effort en push y WhatsApp: el fallo de un canal no impide el otro.
 *   - La función NUNCA lanza. Si el dedupe pasa y hay recipients, retorna 'notified'.
 *   - Zero console.* — logging 100% vía logger inyectado.
 */

import type { Logger } from '@booster-ai/logger';
import type { SafetyEvent } from '@booster-ai/shared-schemas';
import type { Redis } from 'ioredis';
import type { Db } from '../db/client.js';
import type { SafetyRouting } from './route-safety-recipients.js';
import { safetyEventLabel } from './safety-event-labels.js';
import type { ChatPushPayload } from './web-push.js';

export type DispatchOutcome = 'notified' | 'deduped' | 'no_recipient';

/**
 * Formatea el timestamp UTC del evento como hora local en Chile (America/Santiago).
 * Produce una cadena corta y legible para el mensaje de WhatsApp.
 *
 * Ejemplo: "15 jun, 10:00"
 */
function formatHoraLocal(occurredAt: string): string {
  return new Date(occurredAt).toLocaleString('es-CL', {
    timeZone: 'America/Santiago',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: 'short',
  });
}

export async function dispatchSafetyNotification(opts: {
  redis: Redis;
  db: Db;
  logger: Logger;
  event: SafetyEvent;
  routing: SafetyRouting;
  contentSidSafety?: string;
  sendPush: (a: {
    db: Db;
    logger: Logger;
    userId: string;
    payload: ChatPushPayload;
  }) => Promise<unknown>;
  sendWhatsapp: (a: {
    to: string;
    contentSid: string;
    contentVariables: Record<string, string>;
  }) => Promise<unknown>;
}): Promise<DispatchOutcome> {
  const { redis, db, logger, event, routing, contentSidSafety, sendPush, sendWhatsapp } = opts;

  // 1. Dedupe: clave por IMEI + tipo de evento, TTL 600s, solo si no existe.
  const dedupeKey = `safety:dedupe:${event.imei}:${event.eventType}`;
  const setResult = await redis.set(dedupeKey, '1', 'EX', 600, 'NX');

  if (setResult !== 'OK') {
    logger.info(
      { imei: event.imei, eventType: event.eventType },
      'dispatchSafetyNotification: evento duplicado, omitido',
    );
    return 'deduped';
  }

  // 2. Verificar que hay destinatarios.
  if (routing.recipients.length === 0) {
    logger.warn(
      { imei: event.imei, eventType: event.eventType, empresaId: routing.empresaId },
      'dispatchSafetyNotification: no hay destinatarios para el evento',
    );
    return 'no_recipient';
  }

  // 3. Construir partes del mensaje.
  const label = safetyEventLabel(event.eventType);
  const viaje = routing.trackingCode ?? 'Sin viaje activo';
  const hora = formatHoraLocal(event.occurredAt);

  // 4. Push a cada destinatario (best-effort: wrap en try/catch).
  for (const recipient of routing.recipients) {
    const pushPayload: ChatPushPayload = {
      title: '🚨 Alerta de seguridad',
      body: `${routing.vehicleLabel}: ${label}`,
      tag: `safety-${event.imei}-${event.eventType}`,
      data: {
        assignment_id: '',
        message_id: '',
        url: '/app/flota',
      },
    };

    try {
      await sendPush({ db, logger, userId: recipient.userId, payload: pushPayload });
    } catch (err: unknown) {
      logger.error(
        { err, userId: recipient.userId, imei: event.imei, eventType: event.eventType },
        'dispatchSafetyNotification: push falló (best-effort, continuando)',
      );
    }
  }

  // 5. WhatsApp (solo si contentSidSafety está configurado).
  if (contentSidSafety !== undefined) {
    for (const recipient of routing.recipients) {
      if (recipient.phoneE164 === null) {
        continue;
      }

      try {
        await sendWhatsapp({
          to: recipient.phoneE164,
          contentSid: contentSidSafety,
          contentVariables: {
            '1': routing.vehicleLabel,
            '2': label,
            '3': hora,
            '4': viaje,
          },
        });
      } catch (err: unknown) {
        logger.error(
          { err, userId: recipient.userId, imei: event.imei, eventType: event.eventType },
          'dispatchSafetyNotification: whatsapp falló (best-effort, continuando)',
        );
      }
    }
  }

  // 6. Log estructurado del despacho.
  logger.info(
    {
      imei: event.imei,
      empresaId: routing.empresaId,
      eventType: event.eventType,
      recipientCount: routing.recipients.length,
      whatsappEnabled: contentSidSafety !== undefined,
    },
    'dispatchSafetyNotification: notificaciones despachadas',
  );

  return 'notified';
}
