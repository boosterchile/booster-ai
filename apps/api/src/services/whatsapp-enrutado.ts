import { randomUUID } from 'node:crypto';
import type { Logger } from '@booster-ai/logger';
import { type NotificationEvent, notificationEventSchema } from '@booster-ai/shared-schemas';
import {
  type TwilioSendContentParams,
  type WhatsAppContentSender,
  hashTwilioContentForm,
} from '@booster-ai/whatsapp-client';
import { PubSub } from '@google-cloud/pubsub';

/**
 * T10-21 — enrutador del canal WhatsApp entre el envío directo (Twilio desde
 * el api) y `apps/notification-service`. Los emisores (notify-offer,
 * tracking-link, chat fallback, activación, safety) reciben un
 * `WhatsAppContentSender` y no saben cuál camino toma.
 * Spec: `.specs/notification-service-t10-21/spec.md`.
 */
export type ModoNotificaciones = 'directo' | 'sombra' | 'microservicio';

export function modoNotificaciones(flags: {
  viaMicroservicio: boolean;
  sombra: boolean;
}): ModoNotificaciones {
  if (flags.viaMicroservicio) {
    return 'microservicio';
  }
  return flags.sombra ? 'sombra' : 'directo';
}

/** Publica un evento en `notification-events` y devuelve el messageId. */
export type PublicarEventoNotificacion = (evento: NotificationEvent) => Promise<string>;

export function crearPublicadorEventosNotificacion(topicName: string): PublicarEventoNotificacion {
  const topic = new PubSub().topic(topicName);
  return async (evento) =>
    // rls-allowlist: publishMessage de Pub/Sub (notification-events); no es query Drizzle.
    await topic.publishMessage({ data: Buffer.from(JSON.stringify(evento)) });
}

export function crearEnrutadorWhatsApp(opts: {
  modo: ModoNotificaciones;
  /** Cliente Twilio del api; null si sus credenciales no están configuradas. */
  directo: WhatsAppContentSender | null;
  publicar: PublicarEventoNotificacion | null;
  /** `TWILIO_FROM_NUMBER` del api: insumo del hash esperado en sombra. */
  fromNumber: string | null;
  logger: Logger;
  ahora?: () => Date;
  nuevoId?: () => string;
}): WhatsAppContentSender | null {
  const { modo, directo, publicar, fromNumber, logger } = opts;
  const ahora = opts.ahora ?? (() => new Date());
  const nuevoId = opts.nuevoId ?? randomUUID;

  const evento = (
    params: TwilioSendContentParams,
    extra: Pick<NotificationEvent, 'modo' | 'hashEsperado'>,
  ): NotificationEvent =>
    notificationEventSchema.parse({
      version: 1,
      idempotencyKey: nuevoId(),
      canal: 'whatsapp_template',
      destinatario: params.to,
      contentSid: params.contentSid,
      variables: params.contentVariables ?? {},
      emitidoEn: ahora().toISOString(),
      ...extra,
    });

  if (modo === 'directo') {
    return directo;
  }

  if (modo === 'microservicio') {
    if (!publicar) {
      logger.error('NOTIFICATIONS_VIA_MICROSERVICE activo sin publicador: WhatsApp deshabilitado');
      return null;
    }
    return {
      async sendContent(params) {
        const messageId = await publicar(evento(params, { modo: 'enviar' }));
        logger.info(
          { contentSid: params.contentSid, messageId },
          'WhatsApp publicado a notification-service',
        );
        return { sid: `pubsub:${messageId}` };
      },
    };
  }

  // modo sombra
  if (!directo) {
    return null;
  }
  if (!publicar || !fromNumber) {
    logger.warn(
      { hayPublicador: publicar !== null, hayFromNumber: fromNumber !== null },
      'NOTIFICATIONS_SHADOW activo sin publicador o sin TWILIO_FROM_NUMBER: envío directo sin sombra',
    );
    return directo;
  }
  return {
    async sendContent(params) {
      const enviado = await directo.sendContent(params);
      const hashEsperado = hashTwilioContentForm({ fromNumber, ...params });
      try {
        await publicar(evento(params, { modo: 'sombra', hashEsperado }));
      } catch (err) {
        // La sombra nunca afecta el envío real: ya salió por Twilio.
        logger.warn(
          { err, contentSid: params.contentSid },
          'publicación sombra a notification-events falló; envío directo no afectado',
        );
      }
      return enviado;
    },
  };
}
