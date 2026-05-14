import type { Logger } from '@booster-ai/logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ObservabilityCache } from '../../../src/services/observability/cache.js';
import { FxRateService } from '../../../src/services/observability/fx-rate-service.js';

/**
 * Tests del FxRateService (mindicador.cl).
 *
 * Mock del cache con una implementación inline que respeta el contrato
 * `getOrFetch(key, ttl, fetcher)` y `invalidate(key)` — más rápido que
 * mockear ioredis + cache wrapper.
 */

class InMemoryCacheStub {
  private readonly store = new Map<string, unknown>();

  async getOrFetch<T>(key: string, _ttlSec: number, fetcher: () => Promise<T>): Promise<T> {
    if (this.store.has(key)) {
      return this.store.get(key) as T;
    }
    const value = await fetcher();
    this.store.set(key, value);
    return value;
  }

  async invalidate(key: string): Promise<void> {
    this.store.delete(key);
  }

  // Helper para tests: forzar valor en cache
  _set(key: string, value: unknown): void {
    this.store.set(key, value);
  }

  _clear(): void {
    this.store.clear();
  }
}

const fakeLogger: Logger = {
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  child: () => fakeLogger,
} as unknown as Logger;

function makeFetchOk(serie: Array<{ fecha: string; valor: number }>): typeof fetch {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ serie }),
  })) as unknown as typeof fetch;
}

function makeFetchFail(): typeof fetch {
  return vi.fn(async () => {
    throw new Error('ECONNREFUSED');
  }) as unknown as typeof fetch;
}

describe('FxRateService', () => {
  let cache: InMemoryCacheStub;

  beforeEach(() => {
    cache = new InMemoryCacheStub();
    vi.clearAllMocks();
  });

  it('mindicador OK → retorna source=mindicador y guarda en fallback', async () => {
    const fetchImpl = makeFetchOk([{ fecha: '2026-05-13T00:00:00.000Z', valor: 925.34 }]);
    const svc = new FxRateService({
      cache: cache as unknown as ObservabilityCache,
      logger: fakeLogger,
      fetchImpl,
    });

    const rate = await svc.getCurrentRate();
    expect(rate.clpPerUsd).toBe(925.34);
    expect(rate.source).toBe('mindicador');
    expect(rate.observedAt).toBe('2026-05-13T00:00:00.000Z');
  });

  it('mindicador caído + fallback cache hit → source=cache-fallback', async () => {
    const fetchImpl = makeFetchFail();
    // Pre-poblar el fallback cache con un valor "de ayer"
    cache._set('fx:clp-usd:fallback', {
      clpPerUsd: 920,
      observedAt: '2026-05-12T00:00:00.000Z',
      source: 'mindicador',
    });
    const svc = new FxRateService({
      cache: cache as unknown as ObservabilityCache,
      logger: fakeLogger,
      fetchImpl,
    });

    const rate = await svc.getCurrentRate();
    expect(rate.clpPerUsd).toBe(920);
    expect(rate.source).toBe('cache-fallback');
    expect(fakeLogger.warn).toHaveBeenCalled();
  });

  it('mindicador caído + sin fallback → hardcoded 940', async () => {
    const fetchImpl = makeFetchFail();
    const svc = new FxRateService({
      cache: cache as unknown as ObservabilityCache,
      logger: fakeLogger,
      fetchImpl,
    });

    const rate = await svc.getCurrentRate();
    expect(rate.clpPerUsd).toBe(940);
    expect(rate.source).toBe('hardcoded');
  });

  it('usdToClp redondea correctamente al entero más cercano', async () => {
    const fetchImpl = makeFetchOk([{ fecha: '2026-05-13T00:00:00Z', valor: 925.5 }]);
    const svc = new FxRateService({
      cache: cache as unknown as ObservabilityCache,
      logger: fakeLogger,
      fetchImpl,
    });

    const clp = await svc.usdToClp(100);
    expect(clp).toBe(92550); // 100 × 925.50
  });

  it('mindicador retorna body malformado (sin serie) → cae al fallback', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({}), // sin serie
    })) as unknown as typeof fetch;
    cache._set('fx:clp-usd:fallback', {
      clpPerUsd: 900,
      observedAt: '2026-05-10T00:00:00Z',
      source: 'mindicador',
    });
    const svc = new FxRateService({
      cache: cache as unknown as ObservabilityCache,
      logger: fakeLogger,
      fetchImpl,
    });

    const rate = await svc.getCurrentRate();
    expect(rate.clpPerUsd).toBe(900);
    expect(rate.source).toBe('cache-fallback');
  });

  it('mindicador retorna valor inválido (<=0) → fallback', async () => {
    const fetchImpl = makeFetchOk([{ fecha: '2026-05-13T00:00:00Z', valor: 0 }]);
    const svc = new FxRateService({
      cache: cache as unknown as ObservabilityCache,
      logger: fakeLogger,
      fetchImpl,
    });

    const rate = await svc.getCurrentRate();
    expect(rate.clpPerUsd).toBe(940);
    expect(rate.source).toBe('hardcoded');
  });
});
