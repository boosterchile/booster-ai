import type { Logger } from '@booster-ai/logger';
import type Redis from 'ioredis';
import { type Actor, type Snapshot, createActor } from 'xstate';
import { conversationMachine } from './machine.js';

/**
 * Conversation store backed by Redis.
 *
 * Cada sesión se serializa a JSON via XState `getPersistedSnapshot()` y se
 * guarda en una key `bot:session:<phoneE164>` con TTL. Cuando llega un mensaje
 * inbound, deserializamos y rehidratamos el actor — eso permite que cualquier
 * instancia del bot procese cualquier mensaje sin afinidad por user.
 *
 * Operaciones:
 *   - load:    GET → JSON parse → createActor({ snapshot }). Si no existe, crea fresh.
 *   - save:    actor.getPersistedSnapshot() → JSON → SET con EX ttlMs/1000.
 *   - remove:  DEL del key (al terminar el flow).
 *
 * Concurrencia: si dos webhooks del mismo user llegan simultáneamente (Twilio
 * raramente hace eso pero puede), se podría procesar el segundo con un
 * snapshot obsoleto. Aceptable en thin slice — el state machine es lineal y
 * mensajes duplicados no rompen invariantes. Iteración 2: Redis Lua script
 * con WATCH/MULTI o lock distribuido SET NX EX.
 */
export class ConversationStore {
  constructor(
    private readonly redis: Redis,
    private readonly ttlMs: number,
    private readonly logger: Logger,
  ) {}

  /**
   * Carga la sesión del shipper o crea una nueva si no existe.
   * Devuelve el actor ya `start()`-eado y listo para recibir eventos.
   */
  async load(shipperWhatsapp: string): Promise<Session> {
    const key = this.key(shipperWhatsapp);
    const raw = await this.redis.get(key);

    let actor: Actor<typeof conversationMachine>;
    if (raw) {
      try {
        const snapshot = JSON.parse(raw) as Snapshot<unknown>;
        actor = createActor(conversationMachine, { snapshot });
        actor.start();
        // Loggear el value REAL del snapshot rehidratado (no el JSON crudo).
        this.logger.debug(
          { shipperWhatsapp, state: actor.getSnapshot().value },
          'session restored from redis',
        );
        return { shipperWhatsapp, actor };
      } catch (err) {
        // Snapshot corrupto — empezar de cero. Loggear y seguir, no propagar.
        this.logger.warn({ err, shipperWhatsapp }, 'failed to restore snapshot, starting fresh');
        actor = createActor(conversationMachine);
      }
    } else {
      actor = createActor(conversationMachine);
    }
    actor.start();
    return { shipperWhatsapp, actor };
  }

  /**
   * Persiste el snapshot del actor en Redis con TTL.
   * Llamar después de cada `actor.send()`.
   */
  async save(session: Session): Promise<void> {
    const snapshot = session.actor.getPersistedSnapshot();
    const key = this.key(session.shipperWhatsapp);
    const ttlSec = Math.max(1, Math.ceil(this.ttlMs / 1000));
    await this.redis.set(key, JSON.stringify(snapshot), 'EX', ttlSec);
  }

  /**
   * Borra la sesión — se llama cuando el state machine llegó a un final state.
   */
  async remove(shipperWhatsapp: string): Promise<void> {
    await this.redis.del(this.key(shipperWhatsapp));
  }

  private key(shipperWhatsapp: string): string {
    return `bot:session:${shipperWhatsapp}`;
  }
}

export interface Session {
  shipperWhatsapp: string;
  actor: Actor<typeof conversationMachine>;
}
