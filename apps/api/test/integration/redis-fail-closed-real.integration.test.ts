import { createLogger } from '@booster-ai/logger';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { Hono } from 'hono';
import Redis from 'ioredis';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRateLimitPinMiddleware } from '../../src/middleware/rate-limit-pin.js';

const VALID_RUT = '11111111-1';
const REQ: RequestInit = {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ rut: VALID_RUT }),
};
const logger = createLogger({ service: 't8', version: '0', level: 'silent', pretty: false });
const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));

function buildApp(redis: Redis): Hono {
  const app = new Hono();
  app.use(
    '/activate',
    createRateLimitPinMiddleware({
      redis,
      logger,
      limitPerRut: 5,
      limitPerIp: 9999,
      windowSeconds: 60,
    }),
  );
  app.post('/activate', (c) => c.json({ ok: true }, 200));
  return app;
}

describe('T8 SEC-001 — rate-limit-pin contra Redis REAL via testcontainers', () => {
  let container: StartedRedisContainer | undefined;
  let redis: Redis | undefined;
  let app: Hono;

  beforeEach(async () => {
    container = await new RedisContainer('redis:7-alpine').start();
    redis = new Redis({
      host: container.getHost(),
      port: container.getMappedPort(6379),
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
      commandTimeout: 1000,
      retryStrategy: (n) => Math.min(n * 100, 2000),
    });
    await redis.ping();
    app = buildApp(redis);
  }, 60_000);

  afterEach(async () => {
    redis?.disconnect();
    await container?.stop().catch(() => undefined);
    redis = undefined;
    container = undefined;
  });

  it('Scenario 1: Redis up — 5 intentos pasan, 6º retorna 429 scope=rut', async () => {
    for (let i = 1; i <= 5; i += 1) {
      expect((await app.request('/activate', REQ)).status, `request #${i}`).toBe(200);
    }
    const sixth = await app.request('/activate', REQ);
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get('X-RateLimit-Scope')).toBe('rut');
  });

  it('Scenario 2: Redis stopped mid-test — middleware retorna 503 fail-closed con Retry-After', async () => {
    expect((await app.request('/activate', REQ)).status).toBe(200);
    await container?.stop();
    container = undefined;
    await wait(500);

    const r = await app.request('/activate', REQ);
    expect(r.status).toBe(503);
    expect(r.headers.get('Retry-After')).toBe('30');
    expect(await r.json()).toMatchObject({
      error: 'service_unavailable',
      code: 'service_unavailable',
    });
  });

  it('Scenario 3: Redis restart (mismo container) — ioredis auto-reconnect, middleware recupera 200', async () => {
    expect((await app.request('/activate', REQ)).status).toBe(200);

    await container?.restart();
    await wait(2000);

    expect((await app.request('/activate', REQ)).status).toBe(200);
  }, 90_000);
});
