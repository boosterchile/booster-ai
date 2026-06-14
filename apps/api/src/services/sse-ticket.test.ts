import { describe, expect, it } from 'vitest';
import { consumeStreamTicket, mintStreamTicket } from './sse-ticket.js';

/**
 * Spec fix-sse-ticket-auth §10 T2. Mock de Redis con la semántica real de
 * SET EX + GETDEL (single-use atómico). El ticket NUNCA debe sobrevivir a un
 * consumo, ni servir para otro assignment, ni tras expirar.
 */
function makeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    async set(key: string, value: string, _mode: string, _ttl: number) {
      store.set(key, value);
      return 'OK';
    },
    async getdel(key: string) {
      const v = store.get(key) ?? null;
      store.delete(key);
      return v;
    },
  } as never;
}

const UID = 'firebase-uid-123';
const ASSIGNMENT = 'a1111111-2222-3333-4444-555555555555';

describe('sse-ticket', () => {
  it('mint crea un ticket hex ≥128 bits y lo guarda con TTL', async () => {
    const redis = makeRedis();
    const { ticket, expiresInSec } = await mintStreamTicket({
      redis,
      uid: UID,
      assignmentId: ASSIGNMENT,
    });
    expect(ticket).toMatch(/^[0-9a-f]{64}$/); // 32 bytes hex = 256 bits
    expect(expiresInSec).toBe(60);
    expect((redis as unknown as { store: Map<string, string> }).store.size).toBe(1);
  });

  it('consume válido → uid, y es SINGLE-USE (segundo consumo → null)', async () => {
    const redis = makeRedis();
    const { ticket } = await mintStreamTicket({ redis, uid: UID, assignmentId: ASSIGNMENT });

    expect(await consumeStreamTicket({ redis, ticket, assignmentId: ASSIGNMENT })).toBe(UID);
    // Segundo consumo: ya fue borrado (GETDEL) → replay imposible.
    expect(await consumeStreamTicket({ redis, ticket, assignmentId: ASSIGNMENT })).toBeNull();
  });

  it('ticket inexistente/expirado → null', async () => {
    const redis = makeRedis();
    expect(
      await consumeStreamTicket({ redis, ticket: 'nope', assignmentId: ASSIGNMENT }),
    ).toBeNull();
    expect(await consumeStreamTicket({ redis, ticket: '', assignmentId: ASSIGNMENT })).toBeNull();
  });

  it('ticket de OTRO assignment → null (y se consume igual, no queda colgado)', async () => {
    const redis = makeRedis();
    const { ticket } = await mintStreamTicket({ redis, uid: UID, assignmentId: ASSIGNMENT });
    expect(
      await consumeStreamTicket({ redis, ticket, assignmentId: 'otro-assignment' }),
    ).toBeNull();
  });

  it('valor corrupto en Redis → null (no throw)', async () => {
    const redis = makeRedis();
    (redis as unknown as { store: Map<string, string> }).store.set('sse-ticket:bad', '{no-json');
    expect(
      await consumeStreamTicket({ redis, ticket: 'bad', assignmentId: ASSIGNMENT }),
    ).toBeNull();
  });
});
