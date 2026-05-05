import type { AvlRecord } from '@booster-ai/codec8-parser';
import type { Logger } from '@booster-ai/logger';
import type { PubSub, Topic } from '@google-cloud/pubsub';

/**
 * Publica AVL records al topic Pub/Sub `telemetry-events`. El processor
 * los consume + persiste en `telemetria_puntos`.
 *
 * Diseño:
 *   - Una mensaje por record (no por packet) — facilita procesamiento
 *     paralelo + retry granular.
 *   - Attributes incluyen imei + vehicleId + priority para que el
 *     processor pueda routear/filtrar sin parsear el body cuando solo
 *     necesita esos campos.
 *   - Body es JSON serializado del AvlRecord, con timestampMs como
 *     string (porque BigInt no es JSON-serializable directamente).
 *   - publishMessage retorna messageId — lo loggeamos para auditoría
 *     end-to-end (gateway → pubsub → processor → DB).
 */

export interface RecordMessage {
  imei: string;
  /** Si está pendiente de asociación, vehicleId es null. */
  vehicleId: string | null;
  record: AvlRecord;
}

export class TelemetryPublisher {
  private readonly topic: Topic;

  constructor(
    pubsub: PubSub,
    topicName: string,
    private readonly logger: Logger,
  ) {
    this.topic = pubsub.topic(topicName, {
      // Batching: agrupar mensajes para reducir API calls. 100ms o 100
      // mensajes, lo que llegue primero. Esto reduce costo Pub/Sub
      // significativamente cuando hay muchos devices conectados.
      batching: {
        maxMessages: 100,
        maxMilliseconds: 100,
      },
    });
  }

  async publishRecord(msg: RecordMessage): Promise<string> {
    const body = {
      imei: msg.imei,
      vehicleId: msg.vehicleId,
      record: {
        timestampMs: msg.record.timestampMs.toString(),
        priority: msg.record.priority,
        gps: msg.record.gps,
        io: {
          eventIoId: msg.record.io.eventIoId,
          totalIo: msg.record.io.totalIo,
          entries: msg.record.io.entries.map((e) => ({
            id: e.id,
            value:
              typeof e.value === 'bigint'
                ? e.value.toString()
                : Buffer.isBuffer(e.value)
                  ? e.value.toString('base64')
                  : e.value,
            byteSize: e.byteSize,
          })),
        },
      },
    };

    const messageId = await this.topic.publishMessage({
      data: Buffer.from(JSON.stringify(body)),
      attributes: {
        imei: msg.imei,
        vehicleId: msg.vehicleId ?? 'pending',
        priority: String(msg.record.priority),
        timestampMs: msg.record.timestampMs.toString(),
      },
    });
    this.logger.debug(
      { messageId, imei: msg.imei, vehicleId: msg.vehicleId, priority: msg.record.priority },
      'avl record publicado a pubsub',
    );
    return messageId;
  }

  async flush(): Promise<void> {
    await this.topic.flush();
  }
}
