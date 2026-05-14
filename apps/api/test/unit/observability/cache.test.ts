import type { Logger } from '@booster-ai/logger';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests del ObservabilityCache. Mock de ioredis con un Map en memoria.
 *
 * Rationale: ioredis es complejo (pipelines, pubsub). Mock minimal de
 * los métodos que usamos (get/set/del/quit/on) sobre un Map es
 * suficiente y mucho más rápido que setup de Redis real.
 */

const fakeStore = new Map<string, { value: string; expiresAt: number }>();

vi.mock('ioredis', () => {
  class MockRedis {
    async get(key: string): Promise<string | null> {
      const entry = fakeStore.get(key);
      if (!entry) {
        return null;
      }
      if (Date.now() > entry.expiresAt) {
        fakeStore.delete(key);
        return null;
      }
      return entry.value;
    }
    async set(key: string, value: string, _ex: 'EX', ttlSec: number): Promise<'OK'> {
      fakeStore.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
      return 'OK';
    }
    async del(key: string): Promise<number> {
      return fakeStore.delete(key) ? 1 : 0;
    }
    async quit(): Promise<'OK'> {
      return 'OK';
    }
    on(_event: string, _cb: () => void): void {
      // noop
    }
  }
  return { default: MockRedis };
});

// Import después del mock para que vite-node lo aplique.
const { ObservabilityCache } = await import('../../../src/services/observability/cache.js');

const fakeLogger: Logger = {
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  child: () => fakeLogger,
} as unknown as Logger;

describe('ObservabilityCache', () => {
  let cache: InstanceType<typeof ObservabilityCache>;

  beforeEach(() => {
    fakeStore.clear();
    vi.clearAllMocks();
    cache = new ObservabilityCache({
      host: 'localhost',
      port: 6379,
      logger: fakeLogger,
    });
  });

  afterEach(async () => {
    await cache.close();
  });

  it('miss → ejecuta fetcher y cachea por TTL', async () => {
    const fetcher = vi.fn().mockResolvedValue({ data: 'hola' });
    const result = await cache.getOrFetch('key1', 60, fetcher);
    expect(result).toEqual({ data: 'hola' });
    expect(fetcher).toHaveBeenCalledOnce();
    // ioredis set es fire-and-forget; doy un tick para que se asiente.
    await new Promise((r) => setTimeout(r, 5));
    expect(fakeStore.has('obs:key1')).toBe(true);
  });

  it('hit → NO ejecuta fetcher, retorna del cache', async () => {
    const fetcher1 = vi.fn().mockResolvedValue({ v: 1 });
    await cache.getOrFetch('key2', 60, fetcher1);
    await new Promise((r) => setTimeout(r, 5)); // espera set

    const fetcher2 = vi.fn().mockResolvedValue({ v: 999 });
    const result = await cache.getOrFetch('key2', 60, fetcher2);
    expect(result).toEqual({ v: 1 }); // del cache, no del fetcher2
    expect(fetcher2).not.toHaveBeenCalled();
  });

  it('TTL expira → re-fetch', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({ v: 'first' }).mockResolvedValueOnce({
      v: 'second',
    });
    await cache.getOrFetch('key3', 0, fetcher);
    await new Promise((r) => setTimeout(r, 5));
    // expira inmediatamente con TTL=0 + tick.
    // Hacemos sleep > 1s para forzar expiración (Redis tiene resolución de segundos).
    // Pero en este mock Date.now() resolution es ms, así que TTL=0 ya expiró.
    const result = await cache.getOrFetch('key3', 0, fetcher);
    expect(result).toEqual({ v: 'second' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('JSON corrupto en cache → re-fetch y loggea warn', async () => {
    // Manualmente corromper el storage
    fakeStore.set('obs:key4', {
      value: '{ malformed',
      expiresAt: Date.now() + 60_000,
    });
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    const result = await cache.getOrFetch('key4', 60, fetcher);
    expect(result).toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fakeLogger.warn).toHaveBeenCalled();
  });

  it('invalidate elimina la key del cache', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({ v: 'first' }).mockResolvedValueOnce({
      v: 'second',
    });
    await cache.getOrFetch('key5', 60, fetcher);
    await new Promise((r) => setTimeout(r, 5));
    await cache.invalidate('key5');
    const result = await cache.getOrFetch('key5', 60, fetcher);
    expect(result).toEqual({ v: 'second' });
  });
});
