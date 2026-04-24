import { type Actor, createActor } from 'xstate';
import { conversationMachine } from './machine.js';

/**
 * Store in-memory de sesiones de conversación activas.
 *
 * Scope del thin slice: una Map simple con TTL. Esto funciona mientras haya
 * UNA sola instancia de whatsapp-bot (min_instances=1, max_instances=20 en
 * Terraform).
 *
 * Con múltiples instancias, el webhook de Meta puede rutearse a instancias
 * distintas entre mensajes del mismo user → estado perdido. Si sucede:
 *   - Slice 2: migrar a Firestore (realtime sync entre instancias).
 *   - Alternativa: sticky routing por phone_number_id en el LB (menos flexible).
 *
 * Por ahora (thin slice) esto es aceptable porque hay poco tráfico de prueba.
 */
export class ConversationStore {
  private sessions = new Map<string, Session>();

  constructor(private readonly ttlMs: number) {
    // Cleanup periódico — borra sesiones expiradas cada minuto.
    setInterval(() => this.reap(), 60_000).unref();
  }

  /**
   * Obtiene la sesión del shipper o crea una nueva si no existe / expiró.
   */
  getOrCreate(shipperWhatsapp: string): Session {
    const now = Date.now();
    const existing = this.sessions.get(shipperWhatsapp);
    if (existing && existing.expiresAt > now) {
      existing.expiresAt = now + this.ttlMs;
      return existing;
    }

    const actor = createActor(conversationMachine);
    actor.start();
    const session: Session = {
      shipperWhatsapp,
      actor,
      expiresAt: now + this.ttlMs,
    };
    this.sessions.set(shipperWhatsapp, session);
    return session;
  }

  /**
   * Borra la sesión — se llama cuando el state machine llegó a un final state.
   */
  remove(shipperWhatsapp: string): void {
    const session = this.sessions.get(shipperWhatsapp);
    if (session) {
      session.actor.stop();
      this.sessions.delete(shipperWhatsapp);
    }
  }

  private reap(): void {
    const now = Date.now();
    for (const [phone, session] of this.sessions) {
      if (session.expiresAt <= now) {
        session.actor.stop();
        this.sessions.delete(phone);
      }
    }
  }

  size(): number {
    return this.sessions.size;
  }
}

export interface Session {
  shipperWhatsapp: string;
  actor: Actor<typeof conversationMachine>;
  expiresAt: number;
}
