import type { Logger } from '@booster-ai/logger';
import type { ResultadoNotificacion } from './procesar-evento.js';

/** Lo que el manejador usa de un `Message` de @google-cloud/pubsub. */
export interface MensajePubSub {
  id: string;
  data: Buffer;
  ackWithResponse(): Promise<unknown>;
  nack(): void;
}

/**
 * ack/nack de cada mensaje. La subscription tiene exactly-once delivery, así
 * que el ack se confirma (`ackWithResponse`): si falla tras un envío, el
 * mensaje se reentrega y el destinatario puede recibir un duplicado (riesgo
 * aceptado en la spec, medido por este log).
 */
export function crearManejadorMensajes(opts: {
  procesar: (data: Buffer) => Promise<ResultadoNotificacion>;
  logger: Logger;
}): (mensaje: MensajePubSub) => Promise<void> {
  const { procesar, logger } = opts;
  return async (mensaje) => {
    let resultado: ResultadoNotificacion;
    try {
      resultado = await procesar(mensaje.data);
    } catch (err) {
      logger.error(
        { err, messageId: mensaje.id },
        'error transitorio procesando notification-events, nack para reintento',
      );
      mensaje.nack();
      return;
    }
    try {
      await mensaje.ackWithResponse();
    } catch (err) {
      logger.error({ err, messageId: mensaje.id, resultado }, 'ack fallido tras envío');
    }
  };
}
