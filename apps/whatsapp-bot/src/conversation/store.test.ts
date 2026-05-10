import type Redis from 'ioredis';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationStore } from './store.js';

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: vi.fn(),
  error: noop,
  fatal: noop,
  child: () => noopLogger,
} as unknown as ConstructorParameters<typeof ConversationStore>[2];

interface RedisStub {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
}

function makeRedisStub(initial?: Record<string, string>): RedisStub {
  const store = new Map<string, string>(initial ? Object.entries(initial) : []);
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (key: string) => {
      const existed = store.delete(key);
      return existed ? 1 : 0;
    }),
  };
}

describe('ConversationStore', () => {
  const PHONE = '+56912345678';
  const TTL_MS = 30 * 60 * 1000; // 30 min

  let redis: RedisStub;
  let store: ConversationStore;

  beforeEach(() => {
    redis = makeRedisStub();
    store = new ConversationStore(redis as unknown as Redis, TTL_MS, noopLogger);
  });

  it('load() crea sesión nueva si no hay snapshot en Redis', async () => {
    const session = await store.load(PHONE);

    expect(redis.get).toHaveBeenCalledWith(`bot:session:${PHONE}`);
    expect(session.shipperWhatsapp).toBe(PHONE);
    expect(session.actor.getSnapshot().value).toBe('idle');
  });

  it('save() persiste el snapshot con TTL en segundos', async () => {
    const session = await store.load(PHONE);
    session.actor.send({ type: 'USER_MESSAGE', text: 'hola' });
    await store.save(session);

    expect(redis.set).toHaveBeenCalledWith(
      `bot:session:${PHONE}`,
      expect.any(String),
      'EX',
      Math.ceil(TTL_MS / 1000),
    );
  });

  it('load() rehidrata desde snapshot persistido', async () => {
    // Crear, transitar y persistir
    const s1 = await store.load(PHONE);
    s1.actor.send({ type: 'USER_MESSAGE', text: 'hola' });
    await store.save(s1);

    // Cargar de nuevo (otra "instancia" del bot)
    const store2 = new ConversationStore(redis as unknown as Redis, TTL_MS, noopLogger);
    const s2 = await store2.load(PHONE);

    expect(s2.actor.getSnapshot().value).toBe('greeting');
  });

  it('load() ante snapshot corrupto loguea warn y crea fresh', async () => {
    redis = makeRedisStub({ [`bot:session:${PHONE}`]: 'not-json{{{' });
    store = new ConversationStore(redis as unknown as Redis, TTL_MS, noopLogger);

    const session = await store.load(PHONE);

    expect(noopLogger.warn).toHaveBeenCalled();
    expect(session.actor.getSnapshot().value).toBe('idle');
  });

  it('remove() borra la key de Redis', async () => {
    await store.remove(PHONE);
    expect(redis.del).toHaveBeenCalledWith(`bot:session:${PHONE}`);
  });

  it('TTL menor a 1s clampa a 1s mínimo', async () => {
    const tinyStore = new ConversationStore(
      redis as unknown as Redis,
      100, // 100ms → < 1s
      noopLogger,
    );
    const session = await tinyStore.load(PHONE);
    await tinyStore.save(session);
    expect(redis.set).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'EX', 1);
  });
});
