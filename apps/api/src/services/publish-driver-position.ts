import type { Logger } from '@booster-ai/logger';
import { PubSub } from '@google-cloud/pubsub';
import { z } from 'zod';

/**
 * Schema del payload publicado al topic `driver-positions`.
 *
 * Forma canónica compartida con el consumer eco-routing-service (Task 5).
 * Extiende positionSchema de shared-schemas/geo con viajeId + vehiculoId.
 */
export const driverPositionEventSchema = z.object({
  viajeId: z.string().uuid(),
  vehiculoId: z.string().uuid(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  registradoEn: z.string().datetime(),
});

export type DriverPositionEvent = z.infer<typeof driverPositionEventSchema>;

let cached: PubSub | null = null;
function defaultClient(): PubSub {
  if (!cached) {
    cached = new PubSub();
  }
  return cached;
}

/**
 * Publica la posición del conductor PWA al topic `driver-positions`.
 *
 * Fire-and-forget: si publishMessage falla, loguea el error y retorna sin
 * lanzar. Nunca bloquea ni rompe el endpoint POST /driver-position del api.
 *
 * Valida el payload con Zod antes de publicar. Si la validación falla,
 * loguea el error y retorna sin publicar.
 */
export async function publishDriverPosition(opts: {
  topicName: string;
  payload: unknown;
  logger: Logger;
  pubsub?: Pick<PubSub, 'topic'>;
}): Promise<void> {
  const { topicName, payload, logger } = opts;

  if (!topicName) {
    return; // dev/test sin topic configurado
  }

  // Validar el payload antes de publicar.
  const parsed = driverPositionEventSchema.safeParse(payload);
  if (!parsed.success) {
    logger.error(
      { err: parsed.error.flatten(), payload },
      'publishDriverPosition: payload inválido, no se publica',
    );
    return;
  }

  const event = parsed.data;
  const pubsub = opts.pubsub ?? defaultClient();

  try {
    await pubsub.topic(topicName).publishMessage({
      data: Buffer.from(JSON.stringify(event)),
      attributes: {
        viaje_id: event.viajeId,
        vehiculo_id: event.vehiculoId,
      },
    });
  } catch (err) {
    logger.error(
      { err, viajeId: event.viajeId, vehiculoId: event.vehiculoId },
      'publishDriverPosition falló (posición ya persistida en DB)',
    );
  }
}
