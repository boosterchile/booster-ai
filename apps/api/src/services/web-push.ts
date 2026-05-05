/**
 * Web Push notifications (P3.c).
 *
 * Modelo:
 *   1. El browser registra una subscription con su push service (FCM Web,
 *      Mozilla autopush, etc.) y nos envía endpoint + p256dh + auth.
 *   2. Persistimos en `push_subscriptions` (1 row por user × device).
 *   3. Al insertar un mensaje de chat, hacemos lookup de las
 *      subscriptions del DESTINATARIO (el otro lado del chat) y mandamos
 *      un push a cada endpoint via la lib `web-push` con VAPID JWT.
 *   4. Si el push service devuelve 410 Gone (subscription revocada),
 *      marcamos como 'inactiva' (soft-delete; conserva audit trail).
 *
 * Payload del push:
 *   El SW del cliente recibe un JSON con {title, body, tag, data:{...}}
 *   y muestra una notificación native via showNotification(). El click
 *   abre el chat directo via notificationclick handler.
 *
 * Errores:
 *   - 401/403: VAPID inválido (regenerar keys + actualizar Secret Manager).
 *   - 410: subscription revocada (marcar inactive).
 *   - 413: payload too large (>4KB encriptado). Acortar el body.
 *   - 5xx: push service down (reintentar via job nocturno).
 */

import type { Logger } from '@booster-ai/logger';
import { and, eq, ne } from 'drizzle-orm';
import webpush from 'web-push';
import type { Db } from '../db/client.js';
import { assignments, chatMessages, memberships, pushSubscriptions, trips } from '../db/schema.js';

let configured = false;

/**
 * Configura las VAPID keys globalmente. Idempotente. Debe llamarse antes
 * del primer sendPushToUser. El factory de los routes lo hace lazy al
 * primer request.
 */
export function configureWebPush(opts: {
  publicKey: string;
  privateKey: string;
  subject: string;
}): void {
  if (configured) {
    return;
  }
  webpush.setVapidDetails(opts.subject, opts.publicKey, opts.privateKey);
  configured = true;
}

export interface ChatPushPayload {
  /** Título de la notificación (lo que se ve grande). */
  title: string;
  /** Cuerpo (preview del mensaje, hasta ~80 chars para no overflow). */
  body: string;
  /**
   * Tag de la notificación: si llega otra con el mismo tag, reemplaza
   * en vez de apilar (ej. múltiples mensajes del mismo chat). Usar
   * `chat-${assignment_id}`.
   */
  tag: string;
  /** Data opaque que el SW pasa al click handler. */
  data: {
    assignment_id: string;
    message_id: string;
    /** URL relativa a abrir cuando el user clickea. */
    url: string;
  };
}

export interface SendPushResult {
  sent: number;
  invalidated: number;
  errored: number;
}

/**
 * Manda push a TODAS las subscriptions activas del user. Maneja:
 *   - 410 Gone → marca inactive en DB.
 *   - Otros errores → loggea pero sigue (no throwea).
 */
export async function sendPushToUser(opts: {
  db: Db;
  logger: Logger;
  userId: string;
  payload: ChatPushPayload;
}): Promise<SendPushResult> {
  const { db, logger, userId, payload } = opts;

  if (!configured) {
    logger.warn({ userId }, 'sendPushToUser skipped: VAPID no configurado');
    return { sent: 0, invalidated: 0, errored: 0 };
  }

  const subs = await db
    .select({
      id: pushSubscriptions.id,
      endpoint: pushSubscriptions.endpoint,
      p256dhKey: pushSubscriptions.p256dhKey,
      authKey: pushSubscriptions.authKey,
    })
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.status, 'activa')));

  if (subs.length === 0) {
    return { sent: 0, invalidated: 0, errored: 0 };
  }

  const payloadJson = JSON.stringify(payload);
  let sent = 0;
  let invalidated = 0;
  let errored = 0;

  // Mandamos en paralelo. Cap implícito = subs.length por user (típico <5).
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dhKey, auth: sub.authKey },
          },
          payloadJson,
          {
            // TTL del push service: si el browser no está conectado,
            // cuánto tiempo guardar el mensaje. 4h es razonable para chat
            // operativo (después no aporta verlo).
            TTL: 4 * 60 * 60,
            urgency: 'normal',
          },
        );
        sent += 1;
      } catch (err: unknown) {
        const statusCode =
          err && typeof err === 'object' && 'statusCode' in err
            ? Number((err as { statusCode: number }).statusCode)
            : 0;
        if (statusCode === 404 || statusCode === 410) {
          // Subscription revocada — soft-disable.
          await db
            .update(pushSubscriptions)
            .set({
              status: 'inactiva',
              lastFailedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(pushSubscriptions.id, sub.id));
          invalidated += 1;
          logger.info(
            { userId, subscriptionId: sub.id, statusCode },
            'push subscription invalidada (410 Gone) — marcada inactiva',
          );
        } else {
          errored += 1;
          logger.error(
            { err, userId, subscriptionId: sub.id, statusCode },
            'sendPushToUser falló para una subscription',
          );
        }
      }
    }),
  );

  return { sent, invalidated, errored };
}

/**
 * Manda push notification a TODOS los users del lado contrario del chat
 * cuando se inserta un mensaje. "Lado contrario" = users con membership
 * activa en la empresa OPUESTA al sender. Excluye al sender mismo.
 *
 * Llamado fire-and-forget desde POST /messages — si falla, el mensaje
 * ya está en DB y los SSE viewers conectados igual lo reciben.
 */
export async function notifyChatMessageViaPush(opts: {
  db: Db;
  logger: Logger;
  messageId: string;
  webAppUrl: string;
}): Promise<void> {
  const { db, logger, messageId, webAppUrl } = opts;
  if (!configured) {
    logger.warn({ messageId }, 'notifyChatMessageViaPush skipped: VAPID no configurado');
    return;
  }

  // Cargar mensaje + assignment + trip + sender en 1 query.
  const rows = await db
    .select({
      messageId: chatMessages.id,
      assignmentId: chatMessages.assignmentId,
      senderUserId: chatMessages.senderUserId,
      senderEmpresaId: chatMessages.senderEmpresaId,
      senderRole: chatMessages.senderRole,
      messageType: chatMessages.messageType,
      textContent: chatMessages.textContent,
      shipperEmpresaId: trips.generadorCargaEmpresaId,
      carrierEmpresaId: assignments.empresaId,
    })
    .from(chatMessages)
    .innerJoin(assignments, eq(assignments.id, chatMessages.assignmentId))
    .innerJoin(trips, eq(trips.id, assignments.tripId))
    .where(eq(chatMessages.id, messageId))
    .limit(1);

  const msg = rows[0];
  if (!msg) {
    logger.warn({ messageId }, 'notifyChatMessageViaPush: mensaje no encontrado');
    return;
  }

  // Empresa destinataria = la opuesta al sender.
  const recipientEmpresaId =
    msg.senderRole === 'transportista' ? msg.shipperEmpresaId : msg.carrierEmpresaId;

  if (!recipientEmpresaId) {
    // Edge: shipper null en trip (anonymous WhatsApp). Skip.
    logger.warn(
      { messageId, senderRole: msg.senderRole },
      'notifyChatMessageViaPush: empresa destinataria null',
    );
    return;
  }

  // Users con membership activa en la empresa destinataria, excluyendo
  // al sender (que ya vio su propio mensaje en su sesión).
  const recipients = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.empresaId, recipientEmpresaId),
        eq(memberships.status, 'activa'),
        ne(memberships.userId, msg.senderUserId),
      ),
    );

  if (recipients.length === 0) {
    return;
  }

  // Construir payload una vez, reusar para todos los users del lado.
  const preview = buildPreview(msg.messageType, msg.textContent);
  const senderLabel = msg.senderRole === 'transportista' ? 'Transportista' : 'Generador de carga';

  const payload: ChatPushPayload = {
    title: `Nuevo mensaje · ${senderLabel}`,
    body: preview,
    tag: `chat-${msg.assignmentId}`,
    data: {
      assignment_id: msg.assignmentId,
      message_id: msg.messageId,
      // Deep link al chat. El SW abre esta URL al click.
      url: `${webAppUrl.replace(/\/$/, '')}/app/chat/${msg.assignmentId}`,
    },
  };

  // Mandar a cada destinatario en paralelo. Cada uno puede tener varias
  // subscriptions (devices) — sendPushToUser internamente las maneja.
  const results = await Promise.all(
    recipients.map((r) => sendPushToUser({ db, logger, userId: r.userId, payload })),
  );

  const totals = results.reduce(
    (acc, r) => ({
      sent: acc.sent + r.sent,
      invalidated: acc.invalidated + r.invalidated,
      errored: acc.errored + r.errored,
    }),
    { sent: 0, invalidated: 0, errored: 0 },
  );

  logger.info(
    {
      messageId,
      assignmentId: msg.assignmentId,
      recipients: recipients.length,
      ...totals,
    },
    'chat message push notifications dispatched',
  );
}

/**
 * Genera el preview text de la notificación según el tipo de mensaje.
 */
function buildPreview(type: 'texto' | 'foto' | 'ubicacion', textContent: string | null): string {
  if (type === 'texto' && textContent) {
    return textContent.length > 80 ? `${textContent.slice(0, 77)}…` : textContent;
  }
  if (type === 'foto') {
    return '📷 Te envió una foto';
  }
  if (type === 'ubicacion') {
    return '📍 Te compartió una ubicación';
  }
  return 'Mensaje nuevo';
}
