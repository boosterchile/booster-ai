/**
 * Despacha el coaching IA post-entrega como mensaje WhatsApp al dueño
 * del transportista (Phase 3 PR-J3).
 *
 * Disparado desde `confirmar-entrega-viaje.ts` justo después de que
 * `generarCoachingViaje` persiste el mensaje en metricas_viaje. La
 * cadena queda:
 *
 *   recalcularNivelPostEntrega
 *     → calcularScoreConduccionViaje  (persiste behaviorScore + breakdown)
 *     → generarCoachingViaje          (persiste coachingMensaje)
 *     → notifyCoachingToCarrier       (acá — envía WhatsApp)
 *     → emitirCertificadoViaje        (fire-and-forget)
 *
 * Trade-offs de diseño:
 *
 * 1. **Idempotencia por columna**, no por tabla de eventos. Mismo patrón
 *    que `offers.notificado_en` y `chat_messages.whatsapp_notif_enviado_en`.
 *    El UPDATE final usa `WHERE coaching_whatsapp_enviado_en IS NULL`
 *    como guard contra concurrent retries (raros pero posibles si
 *    confirmar-entrega corre dos veces antes de que la primera marca el
 *    timestamp).
 *
 * 2. **Marcar antes del send** (al estilo chat-whatsapp-fallback.ts). Si
 *    el send falla parcial, el coaching queda marcado como enviado y NO
 *    se reintenta. Trade-off explícito: preferimos no spam-dupelar al
 *    transportista (recibir el mismo coaching 2 veces es mala UX) antes
 *    que garantizar delivery 100%. Si el send falla, el coaching igual
 *    está visible en la PWA (BehaviorScoreCard lo muestra desde
 *    metricas_viaje).
 *
 * 3. **Skip silencioso** si:
 *    - Twilio no configurado (dev local sin envs) → reason: 'not_configured'
 *    - Content SID coaching ausente (template Meta pendiente) → 'not_configured'
 *    - El trip no tiene coaching persistido (sin Teltonika → sin score → sin coaching) → 'no_coaching_persisted'
 *    - El trip no tiene assignment → 'no_assignment'
 *    - El transportista no tiene dueño activo → 'no_owner'
 *    - El dueño no tiene whatsapp_e164 cargado → 'no_whatsapp'
 *    - Ya se envió antes (idempotencia) → 'already_notified'
 *
 *    Todos los skips se loguean con razón. NUNCA throwea hacia
 *    confirmar-entrega — un fallo en delivery WhatsApp no debe bloquear
 *    la emisión del cert.
 */

import type { Logger } from '@booster-ai/logger';
import {
  type NotifyCoachingResult,
  buildCoachingTemplateVariables,
} from '@booster-ai/notification-fan-out';
import type { TwilioWhatsAppClient } from '@booster-ai/whatsapp-client';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { assignments, memberships, tripMetrics, trips, users } from '../db/schema.js';

export type { NotifyCoachingResult };

export interface NotifyCoachingDeps {
  db: Db;
  logger: Logger;
  /** Cliente Twilio. null en dev sin envs. */
  twilioClient: TwilioWhatsAppClient | null;
  /** Content SID del template `coaching_post_entrega_v1`. null si pendiente Meta. */
  contentSidCoaching: string | null;
  /** URL del PWA, usada para construir el deep-link al detalle del trip. */
  webAppUrl: string;
}

export async function notifyCoachingToCarrier(
  deps: NotifyCoachingDeps,
  opts: { tripId: string },
): Promise<NotifyCoachingResult> {
  const { db, logger, twilioClient, contentSidCoaching, webAppUrl } = deps;
  const { tripId } = opts;

  if (twilioClient === null || contentSidCoaching === null) {
    logger.warn(
      {
        tripId,
        hasTwilio: twilioClient !== null,
        hasContentSid: contentSidCoaching !== null,
      },
      'notifyCoachingToCarrier skipped — Twilio o ContentSid coaching ausente',
    );
    return { tripId, skipped: true, reason: 'not_configured' };
  }

  // Cargar trip + metricas + assignment + carrier en un round-trip mínimo.
  // Usamos 2 selects (no 1 mega-join) porque el schema es ancho y prefiero
  // claridad — la latencia de 2 round-trips locales a Cloud SQL es < 5ms,
  // bajo el budget de notif post-entrega.
  const tripRows = await db
    .select({ trackingCode: trips.trackingCode })
    .from(trips)
    .where(eq(trips.id, tripId))
    .limit(1);
  const trip = tripRows[0];
  if (!trip) {
    logger.warn({ tripId }, 'notifyCoachingToCarrier: trip no encontrado');
    return { tripId, skipped: true, reason: 'trip_not_found' };
  }

  const metricRows = await db
    .select({
      score: tripMetrics.behaviorScore,
      nivel: tripMetrics.behaviorScoreNivel,
      mensaje: tripMetrics.coachingMensaje,
      coachingWhatsappEnviadoEn: tripMetrics.coachingWhatsappEnviadoEn,
    })
    .from(tripMetrics)
    .where(eq(tripMetrics.tripId, tripId))
    .limit(1);
  const metric = metricRows[0];

  if (!metric?.score || !metric.nivel || !metric.mensaje) {
    logger.info(
      {
        tripId,
        hasMetric: !!metric,
        hasScore: !!metric?.score,
        hasMensaje: !!metric?.mensaje,
      },
      'notifyCoachingToCarrier skipped — sin coaching persistido (trip sin Teltonika o coaching aún no generado)',
    );
    return { tripId, skipped: true, reason: 'no_coaching_persisted' };
  }

  if (metric.coachingWhatsappEnviadoEn !== null) {
    return { tripId, skipped: true, reason: 'already_notified' };
  }

  // Resolver el carrier owner: assignment → empresa → owner activo.
  const assignmentRows = await db
    .select({ empresaId: assignments.empresaId })
    .from(assignments)
    .where(eq(assignments.tripId, tripId))
    .limit(1);
  const assignment = assignmentRows[0];
  if (!assignment) {
    logger.warn({ tripId }, 'notifyCoachingToCarrier: trip sin assignment');
    return { tripId, skipped: true, reason: 'no_assignment' };
  }

  // Owner activo más antiguo (idéntico patrón a notify-offer.ts y
  // chat-whatsapp-fallback.ts — DRY-fy a un helper si aparece un 4to caso).
  const ownerRows = await db
    .select({
      userId: users.id,
      whatsappE164: users.whatsappE164,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.empresaId, assignment.empresaId),
        eq(memberships.role, 'dueno'),
        eq(memberships.status, 'activa'),
      ),
    )
    .orderBy(memberships.createdAt)
    .limit(1);
  const owner = ownerRows[0];

  if (!owner) {
    logger.warn(
      { tripId, empresaId: assignment.empresaId },
      'notifyCoachingToCarrier: empresa transportista sin dueño activo',
    );
    return { tripId, skipped: true, reason: 'no_owner' };
  }

  if (!owner.whatsappE164) {
    logger.warn(
      { tripId, ownerUserId: owner.userId },
      'notifyCoachingToCarrier: dueño sin whatsapp_e164',
    );
    return { tripId, skipped: true, reason: 'no_whatsapp' };
  }

  // Marcar ANTES del send: si Twilio falla, NO reintentamos (anti-spam,
  // mismo trade-off que chat-whatsapp-fallback). El UPDATE con
  // `coachingWhatsappEnviadoEn IS NULL` también actúa como guard contra
  // un retry concurrente que pase la check de líneas arriba.
  const markResult = await db
    .update(tripMetrics)
    .set({ coachingWhatsappEnviadoEn: new Date() })
    .where(and(eq(tripMetrics.tripId, tripId), isNull(tripMetrics.coachingWhatsappEnviadoEn)))
    .returning({ tripId: tripMetrics.tripId });

  if (markResult.length === 0) {
    // Otra ejecución concurrente ya marcó — no enviamos para no dupelar.
    return { tripId, skipped: true, reason: 'already_notified' };
  }

  const variables = buildCoachingTemplateVariables({
    trackingCode: trip.trackingCode,
    score: Number(metric.score),
    nivel: metric.nivel,
    mensaje: metric.mensaje,
    tripId,
    webAppUrl,
  });

  const response = await twilioClient.sendContent({
    to: owner.whatsappE164,
    contentSid: contentSidCoaching,
    contentVariables: variables,
  });

  logger.info(
    {
      tripId,
      ownerUserId: owner.userId,
      empresaId: assignment.empresaId,
      trackingCode: trip.trackingCode,
      twilioSid: response.sid,
    },
    'notifyCoachingToCarrier sent',
  );

  return { tripId, skipped: false, twilioMessageSid: response.sid };
}
