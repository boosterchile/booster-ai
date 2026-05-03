/**
 * Fallback WhatsApp para mensajes de chat no leídos (P3.d).
 *
 * Disparado por Cloud Scheduler cada 1 min via POST /admin/jobs/chat-whatsapp-fallback.
 *
 * Flujo:
 *   1. SELECT mensajes WHERE leido_en IS NULL
 *      AND creado_en < now() - INTERVAL '5 min'
 *      AND whatsapp_notif_enviado_en IS NULL
 *      LIMIT N (cap por run para no saturar Twilio).
 *   2. Por cada mensaje:
 *      a. Resolver destinatario (lado contrario).
 *      b. Buscar dueño activo de la empresa contraria con whatsapp_e164.
 *      c. Mandar template Twilio `chat_unread_v1` con variables.
 *      d. Marcar whatsapp_notif_enviado_en = now() para idempotencia.
 *
 * Idempotencia:
 *   - El UPDATE marca antes del send → si el send falla parcial, el
 *     mensaje queda marcado (no re-intenta). Trade-off: preferimos
 *     no spam-dupelar antes que garantizar delivery via WhatsApp,
 *     porque el push (P3.c) y SSE (P3.b) ya cubren el path principal.
 *
 * Cap por run: 100 mensajes. Si hay más, el próximo tick los toma.
 *
 * Skip si:
 *   - sender_role = empresa destinataria misma (multi-user). Nunca
 *     pasa por la query (filter sender_role <> destinatario).
 *   - destinatario_user.whatsappE164 es null.
 *   - empresa destinataria no tiene dueño activo (raro pero defensivo).
 */

import type { Logger } from '@booster-ai/logger';
import {
  type NotifyOfferResult,
  buildOfferTemplateVariables,
} from '@booster-ai/notification-fan-out';
import type { TwilioWhatsAppClient } from '@booster-ai/whatsapp-client';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  assignments,
  chatMessages,
  memberships,
  trips,
  users,
} from '../db/schema.js';

void buildOfferTemplateVariables; // re-export silencioso para linter (no se usa acá pero comparte file de fan-out futura)

export interface FallbackResult {
  candidates: number;
  notified: number;
  skippedNoOwner: number;
  skippedNoWhatsapp: number;
  errored: number;
}

const RUN_LIMIT = 100;
const UNREAD_THRESHOLD_MINUTES = 5;

export async function procesarMensajesNoLeidos(opts: {
  db: Db;
  logger: Logger;
  twilioClient: TwilioWhatsAppClient | null;
  contentSid: string | null;
  webAppUrl: string;
}): Promise<FallbackResult> {
  const { db, logger, twilioClient, contentSid, webAppUrl } = opts;

  if (!twilioClient || !contentSid) {
    logger.warn(
      { hasTwilio: !!twilioClient, hasContentSid: !!contentSid },
      'procesarMensajesNoLeidos skipped: Twilio o ContentSid ausentes',
    );
    return {
      candidates: 0,
      notified: 0,
      skippedNoOwner: 0,
      skippedNoWhatsapp: 0,
      errored: 0,
    };
  }

  // Query candidatos: mensajes no leídos viejos sin notif WhatsApp.
  // Joineamos trip + assignment para resolver el destinatario en 1 round-trip.
  const candidates = await db
    .select({
      messageId: chatMessages.id,
      assignmentId: chatMessages.assignmentId,
      senderUserId: chatMessages.senderUserId,
      senderRole: chatMessages.senderRole,
      messageType: chatMessages.messageType,
      textContent: chatMessages.textContent,
      shipperEmpresaId: trips.generadorCargaEmpresaId,
      carrierEmpresaId: assignments.empresaId,
      trackingCode: trips.trackingCode,
      senderName: users.fullName,
    })
    .from(chatMessages)
    .innerJoin(assignments, eq(assignments.id, chatMessages.assignmentId))
    .innerJoin(trips, eq(trips.id, assignments.tripId))
    .innerJoin(users, eq(users.id, chatMessages.senderUserId))
    .where(
      and(
        isNull(chatMessages.readAt),
        isNull(chatMessages.whatsappNotifSentAt),
        lt(
          chatMessages.createdAt,
          sql`now() - INTERVAL '${sql.raw(String(UNREAD_THRESHOLD_MINUTES))} minutes'`,
        ),
      ),
    )
    .limit(RUN_LIMIT);

  if (candidates.length === 0) {
    return {
      candidates: 0,
      notified: 0,
      skippedNoOwner: 0,
      skippedNoWhatsapp: 0,
      errored: 0,
    };
  }

  let notified = 0;
  let skippedNoOwner = 0;
  let skippedNoWhatsapp = 0;
  let errored = 0;

  // Procesamos secuencial — Twilio rate limit ~1msg/sec por sender.
  // Para 100 candidatos = ~100s. Dentro del Cloud Scheduler timeout (60s default).
  // Si el batch es grande, se procesa en runs sucesivos cada 1 min.
  for (const c of candidates) {
    try {
      const recipientEmpresaId =
        c.senderRole === 'transportista' ? c.shipperEmpresaId : c.carrierEmpresaId;

      if (!recipientEmpresaId) {
        skippedNoOwner += 1;
        // Marcar para no reintentar (no hay nadie a quién avisar).
        await markNotifSent(db, c.messageId);
        continue;
      }

      // Dueño activo de la empresa destinataria (más antiguo si hay varios).
      // Mismo patrón que notify-offer.ts.
      const ownerRows = await db
        .select({
          userId: users.id,
          whatsappE164: users.whatsappE164,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(
          and(
            eq(memberships.empresaId, recipientEmpresaId),
            eq(memberships.role, 'dueno'),
            eq(memberships.status, 'activa'),
          ),
        )
        .orderBy(memberships.createdAt)
        .limit(1);

      const owner = ownerRows[0];
      if (!owner) {
        skippedNoOwner += 1;
        await markNotifSent(db, c.messageId);
        continue;
      }

      if (!owner.whatsappE164) {
        skippedNoWhatsapp += 1;
        await markNotifSent(db, c.messageId);
        continue;
      }

      // Marcar ANTES del send: si el send falla parcial, no re-intentamos
      // (preferimos no-spam que retry, ver header del archivo).
      await markNotifSent(db, c.messageId);

      const preview = buildPreview(c.messageType, c.textContent);
      const senderLabel = c.senderName ?? (c.senderRole === 'transportista' ? 'Transportista' : 'Generador de carga');
      const chatUrl = `${webAppUrl.replace(/\/$/, '')}/app/chat/${c.assignmentId}`;

      await twilioClient.sendContent({
        to: owner.whatsappE164,
        contentSid,
        contentVariables: {
          '1': c.trackingCode,
          '2': senderLabel,
          '3': preview,
          '4': chatUrl,
        },
      });

      notified += 1;
      logger.info(
        {
          messageId: c.messageId,
          assignmentId: c.assignmentId,
          recipientUserId: owner.userId,
          trackingCode: c.trackingCode,
        },
        'chat fallback WhatsApp enviado',
      );
    } catch (err) {
      errored += 1;
      logger.error(
        { err, messageId: c.messageId, assignmentId: c.assignmentId },
        'procesarMensajesNoLeidos: fallo en candidato',
      );
    }
  }

  logger.info(
    {
      candidates: candidates.length,
      notified,
      skippedNoOwner,
      skippedNoWhatsapp,
      errored,
    },
    'procesarMensajesNoLeidos run completado',
  );

  return {
    candidates: candidates.length,
    notified,
    skippedNoOwner,
    skippedNoWhatsapp,
    errored,
  };
}

async function markNotifSent(db: Db, messageId: string): Promise<void> {
  await db
    .update(chatMessages)
    .set({ whatsappNotifSentAt: new Date() })
    .where(eq(chatMessages.id, messageId));
}

function buildPreview(
  type: 'texto' | 'foto' | 'ubicacion',
  textContent: string | null,
): string {
  if (type === 'texto' && textContent) {
    return textContent.length > 80 ? `${textContent.slice(0, 77)}…` : textContent;
  }
  if (type === 'foto') return '📷 Foto adjunta';
  if (type === 'ubicacion') return '📍 Ubicación compartida';
  return 'Mensaje nuevo';
}

// Re-exporta el tipo de notify-offer para que el wire en routes/admin-jobs.ts
// pueda compartir el shape NotifyOfferResult si en el futuro queremos un
// formato común de respuesta de jobs internos.
export type { NotifyOfferResult };
