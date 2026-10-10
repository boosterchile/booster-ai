import type { Logger } from '@booster-ai/logger';
import { notificationEventSchema } from '@booster-ai/shared-schemas';
import {
  TwilioApiError,
  type WhatsAppContentSender,
  hashTwilioContentForm,
} from '@booster-ai/whatsapp-client';

/**
 * Resultados terminales de un mensaje de `notification-events`: todos se
 * confirman (ack). Un error transitorio no tiene resultado: se propaga y el
 * consumer hace nack (reintento → DLQ tras 5).
 */
export type ResultadoNotificacion =
  | 'enviado'
  | 'sombra_coincide'
  | 'sombra_diverge'
  | 'descartado'
  | 'rechazado_proveedor';

/**
 * Procesa un evento de `notification-events` (T10-21,
 * `.specs/notification-service-t10-21/spec.md`).
 *
 *   - `enviar`: entrega el template por Twilio con las credenciales del servicio.
 *   - `sombra`: el api ya lo envió; se arma el request con el sender propio y
 *     se compara su hash con `hashEsperado`. Nunca envía. El log
 *     `notificacion sombra diverge` alimenta la métrica
 *     `notification_shadow_divergencias` (infrastructure/notification-service.tf).
 */
export async function procesarEventoNotificacion(opts: {
  data: Buffer;
  sender: WhatsAppContentSender;
  fromNumber: string;
  logger: Logger;
}): Promise<ResultadoNotificacion> {
  const { sender, fromNumber, logger } = opts;
  const texto = opts.data.toString('utf-8');

  let crudo: unknown;
  try {
    crudo = JSON.parse(texto);
  } catch {
    logger.error(
      { preview: texto.slice(0, 200) },
      'notification-events no es JSON, descartado (sin reintento)',
    );
    return 'descartado';
  }
  const parsed = notificationEventSchema.safeParse(crudo);
  if (!parsed.success) {
    logger.error(
      { errors: parsed.error.issues },
      'notification-events fuera de contrato, descartado (sin reintento)',
    );
    return 'descartado';
  }
  const evento = parsed.data;
  const params = {
    to: evento.destinatario,
    contentSid: evento.contentSid,
    contentVariables: evento.variables,
  };

  if (evento.modo === 'sombra') {
    const hashServicio = hashTwilioContentForm({ fromNumber, ...params });
    if (hashServicio === evento.hashEsperado) {
      logger.info(
        { idempotencyKey: evento.idempotencyKey, contentSid: evento.contentSid },
        'notificacion sombra coincide',
      );
      return 'sombra_coincide';
    }
    logger.warn(
      {
        idempotencyKey: evento.idempotencyKey,
        contentSid: evento.contentSid,
        hashEsperado: evento.hashEsperado,
        hashServicio,
      },
      'notificacion sombra diverge',
    );
    return 'sombra_diverge';
  }

  try {
    const enviado = await sender.sendContent(params);
    logger.info(
      {
        idempotencyKey: evento.idempotencyKey,
        contentSid: evento.contentSid,
        twilioSid: enviado.sid,
      },
      'notificacion enviada',
    );
    return 'enviado';
  } catch (err) {
    // 4xx de Twilio (número inválido, template no aprobado): reintentar no lo
    // arregla. 429 y 5xx sí son transitorios.
    if (
      err instanceof TwilioApiError &&
      err.status >= 400 &&
      err.status < 500 &&
      err.status !== 429
    ) {
      logger.error(
        {
          idempotencyKey: evento.idempotencyKey,
          contentSid: evento.contentSid,
          status: err.status,
          response: err.responseBody,
        },
        'notificacion rechazada por Twilio (no se reintenta)',
      );
      return 'rechazado_proveedor';
    }
    throw err;
  }
}
