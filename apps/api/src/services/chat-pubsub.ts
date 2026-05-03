/**
 * Chat realtime via Pub/Sub + SSE (P3.b).
 *
 * Modelo:
 *   - Topic `chat-messages`: cada vez que el api inserta un mensaje en
 *     `mensajes_chat`, publica al topic con atributo `assignment_id`.
 *   - SSE consumer: el GET /assignments/:id/messages/stream crea una
 *     subscription efímera con filter `attributes.assignment_id = "..."`
 *     y empuja los mensajes al cliente via SSE. Cuando el cliente cierra
 *     la conexión (window unload, navegación), la subscription se borra.
 *
 * Por qué subscription efímera por viewer en vez de 1 compartida:
 *   - Filter server-side: cada SSE solo recibe los mensajes del
 *     assignment que está mirando, sin tener que filtrar en aplicación.
 *   - Aislamiento: si un consumer crashea, no afecta a los otros.
 *   - Latencia aceptable: ~500ms para crear subscription al conectar.
 *     Para chat (no live trading) es ok.
 *
 * Costo: subscriptions Pub/Sub idle son ~$0.40/mes/subscription. Si
 * tenemos 100 viewers concurrent, $40/mes. Aceptable. Si crece a miles,
 * migrar a 1 subscription compartida con filtrado en aplicación.
 *
 * Naming: las subscriptions efímeras usan prefix `chat-sse-` + uuid
 * para que sean fáciles de identificar y limpiar manualmente con
 * `gcloud pubsub subscriptions list --filter="name:chat-sse-*"` si
 * algún cleanup falla (ej. Cloud Run instance murió sin disconnect).
 *
 * Cleanup automático: la subscription tiene `expirationPolicy.ttl=24h`
 * para que GCP la borre sola si quedó huérfana. El handler también la
 * borra explícitamente al fin del SSE.
 */

import { PubSub, type Subscription } from '@google-cloud/pubsub';
import type { Logger } from '@booster-ai/logger';

let cachedClient: PubSub | null = null;

function getClient(): PubSub {
  if (!cachedClient) {
    cachedClient = new PubSub();
  }
  return cachedClient;
}

/**
 * Publica un mensaje del chat al topic. Llamado fire-and-forget post-INSERT.
 */
export async function publishChatMessage(opts: {
  topicName: string;
  logger: Logger;
  assignmentId: string;
  messageId: string;
}): Promise<void> {
  const { topicName, logger, assignmentId, messageId } = opts;
  try {
    const topic = getClient().topic(topicName);
    const messageData = JSON.stringify({ message_id: messageId, assignment_id: assignmentId });
    await topic.publishMessage({
      data: Buffer.from(messageData),
      // Atributo para el filter de la subscription efímera. El SSE
      // subscriber solo recibe mensajes con su assignment_id.
      attributes: {
        assignment_id: assignmentId,
      },
    });
  } catch (err) {
    // Fire-and-forget: si Pub/Sub falla, el mensaje ya está en DB. La UI
    // se va a enterar al próximo refetch o cuando otro mensaje publique
    // OK. No queremos crashear el endpoint POST por esto.
    logger.error(
      { err, assignmentId, messageId },
      'publishChatMessage falló (mensaje ya está en DB; SSE puede no notificar)',
    );
  }
}

/**
 * Crea una subscription efímera al topic, filtrada por assignment_id.
 * Devuelve un AsyncIterable de mensajes que el handler SSE itera y
 * empuja al cliente. Cuando el caller hace `cleanup()`, la subscription
 * se borra de GCP.
 */
export async function createEphemeralChatSubscription(opts: {
  topicName: string;
  logger: Logger;
  assignmentId: string;
}): Promise<{
  subscription: Subscription;
  /** Borra la subscription en GCP. Llamar al final del SSE (incluso si crashed). */
  cleanup: () => Promise<void>;
}> {
  const { topicName, logger, assignmentId } = opts;
  const client = getClient();

  // El nombre tiene que ser único por viewer. Prefijo para identificar
  // visualmente y poder limpiar manualmente si algún día queda huérfana.
  const subscriptionName = `chat-sse-${assignmentId}-${crypto.randomUUID().slice(0, 8)}`;

  const topic = client.topic(topicName);
  const [subscription] = await topic.createSubscription(subscriptionName, {
    // Filter server-side: solo recibimos los mensajes del assignment
    // que el viewer está mirando.
    filter: `attributes.assignment_id = "${assignmentId}"`,
    // TTL para auto-cleanup si el handler crashea sin llamar a delete().
    expirationPolicy: { ttl: { seconds: 24 * 60 * 60 } },
    // ACK rápido — los mensajes son notificaciones efímeras, si se
    // pierden no es crítico (la UI se entera al refetch).
    ackDeadlineSeconds: 10,
    // Sin retención adicional; los mensajes que no se entregan
    // inmediatamente se descartan.
    retainAckedMessages: false,
    messageRetentionDuration: { seconds: 600 }, // 10 min
  });

  logger.info(
    { subscriptionName, assignmentId },
    'createEphemeralChatSubscription: subscription creada',
  );

  return {
    subscription,
    cleanup: async () => {
      try {
        await subscription.close();
        await subscription.delete();
        logger.info(
          { subscriptionName, assignmentId },
          'createEphemeralChatSubscription: subscription cerrada y borrada',
        );
      } catch (err) {
        // No throwear desde el cleanup. Si algo falla, el TTL la borra
        // en 24h. Loggeamos para investigar si pasa seguido.
        logger.warn(
          { err, subscriptionName, assignmentId },
          'createEphemeralChatSubscription cleanup falló (TTL la limpia en 24h)',
        );
      }
    },
  };
}
