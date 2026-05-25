import type { Logger } from '@booster-ai/logger';
import type { Auth, UserRecord } from 'firebase-admin/auth';
import { Hono } from 'hono';
import type Redis from 'ioredis';
import { describe, expect, test } from 'vitest';
import { createDemoExpiresMiddleware } from '../../src/middleware/demo-expires.js';
import type { FirebaseClaims } from '../../src/middleware/firebase-auth.js';

/**
 * T5 SEC-001 Sprint 2a — perf integration test del middleware
 * demo-expires (spec sec-001-cierre §3 H1.1 SC-1.1.2b + §6.8).
 *
 * Budget validado:
 *   - p95 cached ≤ 5ms
 *   - p95 uncached ≤ 200ms (1× getUser only, sin verifyIdToken redundante)
 *
 * Implementación per plan v4 P1-R2-4: mocked network layer (no Firebase
 * emulator). Mock simula latencia Firebase Admin SDK ~50ms (P50 típico
 * región WAN) + Redis stub in-memory. La aserción mide el OVERHEAD del
 * middleware sobre estos mocks — el budget real en prod incluye también
 * red layer real, pero esta test garantiza que el código del middleware
 * no agrega overhead significativo.
 */

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  child: () => noopLogger,
} as unknown as Logger;

const DEMO_CLAIMS: FirebaseClaims = {
  uid: 'perf-demo-uid-1',
  email: 'demo-2026-shipper@boosterchile.com',
  emailVerified: false,
  name: 'Perf Demo',
  picture: undefined,
  custom: { is_demo: true, persona: 'generador_carga' },
};

function futureISO(days: number): string {
  return new Date(Date.now() + days * 86400 * 1000).toISOString();
}

function p95(samplesMs: number[]): number {
  if (samplesMs.length === 0) {
    return 0;
  }
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const idx = Math.ceil(0.95 * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

function makeRedisInMemory() {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    },
  } as unknown as Redis;
}

function makeAuthWithLatency(latencyMs: number, user: Partial<UserRecord>) {
  return {
    getUser: async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, latencyMs));
      return user as UserRecord;
    },
  } as unknown as Auth;
}

describe('demo-expires perf (integration)', () => {
  test('p95 uncached < 200ms con Firebase mock latency 50ms (50 muestras)', async () => {
    const redis = makeRedisInMemory();
    const auth = makeAuthWithLatency(50, {
      uid: 'perf-demo-uid-1',
      disabled: false,
      customClaims: { is_demo: true, expires_at: futureISO(7) },
    });

    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('firebaseClaims', DEMO_CLAIMS);
      await next();
    });
    app.use('*', createDemoExpiresMiddleware({ auth, redis, logger: noopLogger }));
    app.get('/protected', (c) => c.json({ ok: true }));

    // Warm-up: 5 requests (poblamos cache).
    for (let i = 0; i < 5; i++) {
      await app.request('/protected');
    }

    // Reset cache via different uid: cada sample es uncached (fresh uid).
    const samples: number[] = [];
    const N = 50;
    for (let i = 0; i < N; i++) {
      // Fresh uid per request → cada uno cache miss → fuerza getUser.
      const freshClaims = { ...DEMO_CLAIMS, uid: `perf-demo-uid-${i}` };
      const freshApp = new Hono();
      freshApp.use('*', async (c, next) => {
        c.set('firebaseClaims', freshClaims);
        await next();
      });
      freshApp.use('*', createDemoExpiresMiddleware({ auth, redis, logger: noopLogger }));
      freshApp.get('/protected', (c) => c.json({ ok: true }));

      const t0 = performance.now();
      const res = await freshApp.request('/protected');
      const elapsed = performance.now() - t0;
      expect(res.status).toBe(200);
      samples.push(elapsed);
    }

    const measuredP95 = p95(samples);
    // Budget: 200ms p95. Mock latency 50ms + middleware overhead.
    // Headroom típico observado: ~80-100ms p95 (no Redis I/O real).
    expect(measuredP95).toBeLessThan(200);
  });

  test('p95 cached < 5ms cuando snapshot ya en Redis (50 muestras)', async () => {
    const redis = makeRedisInMemory();
    const auth = makeAuthWithLatency(500, {
      uid: 'perf-cached-uid',
      disabled: false,
      customClaims: { is_demo: true, expires_at: futureISO(7) },
    });

    // Pre-seed cache para el uid de test.
    await redis.set(
      'demo-claim:perf-cached-uid',
      JSON.stringify({
        uid: 'perf-cached-uid',
        disabled: false,
        customClaims: { is_demo: true, expires_at: futureISO(7) },
      }),
    );

    const cachedClaims = { ...DEMO_CLAIMS, uid: 'perf-cached-uid' };
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('firebaseClaims', cachedClaims);
      await next();
    });
    app.use('*', createDemoExpiresMiddleware({ auth, redis, logger: noopLogger }));
    app.get('/protected', (c) => c.json({ ok: true }));

    // Warm-up
    for (let i = 0; i < 5; i++) {
      await app.request('/protected');
    }

    const samples: number[] = [];
    const N = 50;
    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      const res = await app.request('/protected');
      const elapsed = performance.now() - t0;
      expect(res.status).toBe(200);
      samples.push(elapsed);
    }

    // Si auth.getUser hubiera sido llamado, p95 sería ~500ms (mock
    // latency). Cache hit garantiza skip → p95 << 5ms en in-memory
    // Redis. Real prod con Redis network: ~5ms p95 budget.
    const measuredP95 = p95(samples);
    expect(measuredP95).toBeLessThan(5);
  });
});
