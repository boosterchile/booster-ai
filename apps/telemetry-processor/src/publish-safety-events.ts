import type { Logger } from '@booster-ai/logger';
import type { SafetyEvent } from '@booster-ai/shared-schemas';
import { PubSub } from '@google-cloud/pubsub';

let cached: PubSub | null = null;
function defaultClient(): PubSub {
  if (!cached) {
    cached = new PubSub();
  }
  return cached;
}

/** Publica un SafetyEvent al topic. Fire-and-forget: nunca lanza ni bloquea el ack del record. */
export async function publishSafetyEvent(opts: {
  topicName: string;
  event: SafetyEvent;
  logger: Logger;
  pubsub?: Pick<PubSub, 'topic'>;
}): Promise<void> {
  const { topicName, event, logger } = opts;
  if (!topicName) {
    return; // dev/test sin topic configurado
  }
  const pubsub = opts.pubsub ?? defaultClient();
  try {
    await pubsub.topic(topicName).publishMessage({
      data: Buffer.from(JSON.stringify(event)),
      attributes: { imei: event.imei, event_type: event.eventType },
    });
  } catch (err) {
    logger.error(
      { err, imei: event.imei, eventType: event.eventType },
      'publishSafetyEvent falló (evento ya logueado para on-call)',
    );
  }
}
