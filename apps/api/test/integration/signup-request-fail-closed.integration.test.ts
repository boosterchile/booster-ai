import { createLogger } from '@booster-ai/logger';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { Hono } from 'hono';
import Redis from 'ioredis';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRateLimitSignupMiddleware } from '../../src/middleware/rate-limit-signup.js';
import { createSignupRequestRoutes } from '../../src/routes/signup-request.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * T9b SEC-001 Sprint 2b — Integration tests fail-closed semantics + cloud-armor
 * cascade verification para POST /api/v1/signup-request (sec-001-cierre §3
 * H1.2 SC-1.2.5 completion).
 *
 * Mismo pattern Sprint 2a `redis-fail-closed-real.integration.test.ts` (T8):
 * usa testcontainers Redis real (no mock) y verifica el comportamiento del
 * middleware cuando el container se detiene mid-test. Confirma fail-closed
 * loudly: rate-limit es defensa de seguridad, NO degradable a fail-open
 * (paridad SC-H2.1b ↔ SC-1.2.5).
 *
 * Test 2 documenta que el middleware NO inspecciona headers Cloud Armor — la
 * capa Cloud Armor vive en el LB upstream (ver docs/qa/rate-limit-cascade.md
 * §signup-request layer). En el caso real de Cloud Armor ban, el request
 * jamás llega al runtime Cloud Run; este test verifica que un header sintético
 * no rompe el middleware ni lo confunde.
 */
const VALID_BODY = JSON.stringify({
  email: 'integration-failclosed@cliente.cl',
  nombreCompleto: 'Failclosed Tester',
});
const REQ: RequestInit = {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-forwarded-for': '4.4.4.4' },
  body: VALID_BODY,
};
const logger = createLogger({
  service: 'signup-failclosed-integration',
  version: '0',
  level: 'silent',
  pretty: false,
});
const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));

function buildApp(dbHandle: TestDbHandle, redis: Redis): Hono {
  const app = new Hono();
  app.use(
    '/api/v1/signup-request',
    createRateLimitSignupMiddleware({ redis, logger, limitPerIp: 1000, windowSeconds: 900 }),
  );
  app.route('/api/v1/signup-request', createSignupRequestRoutes({ db: dbHandle.db, logger }));
  return app;
}

describe('integration: POST /api/v1/signup-request fail-closed + cloud-armor cascade (SC-1.2.5)', () => {
  let dbHandle: TestDbHandle;
  let container: StartedRedisContainer | undefined;
  let redis: Redis | undefined;
  let app: Hono;

  beforeEach(async () => {
    dbHandle = createTestDb();
    await dbHandle.pool.query("DELETE FROM solicitudes_registro WHERE email LIKE 'integration-%'");

    container = await new RedisContainer('redis:7-alpine').start();
    redis = new Redis({
      host: container.getHost(),
      port: container.getMappedPort(6379),
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      commandTimeout: 1500,
      lazyConnect: true,
      retryStrategy: (n) => Math.min(n * 100, 1000),
    });
    redis.on('error', () => undefined);
    await redis.connect();
    await redis.ping();
    app = buildApp(dbHandle, redis);
  }, 120_000);

  afterEach(async () => {
    redis?.disconnect();
    await container?.stop().catch(() => undefined);
    await dbHandle?.pool.end();
    redis = undefined;
    container = undefined;
  });

  it('Scenario 1: Redis up → request 202; Redis stop → request 503 fail-closed + Retry-After:30', async () => {
    // Up: passthrough con INSERT.
    const up = await app.request('/api/v1/signup-request', REQ);
    expect(up.status).toBe(202);

    // Stop container mid-test (mismo pattern Sprint 2a T8 scenario 2).
    await container?.stop();
    container = undefined;
    await wait(500);

    const down = await app.request('/api/v1/signup-request', REQ);
    expect(down.status).toBe(503);
    expect(down.headers.get('Retry-After')).toBe('30');
    const json = (await down.json()) as { error: string; code: string };
    expect(json.error).toBe('service_unavailable');
    expect(json.code).toBe('service_unavailable');

    // Critical: el row del primer request quedó en DB; el row del segundo NO
    // se insertó (middleware fail-closed 503 antes del handler).
    const rows = await dbHandle.pool.query<{ c: number }>(
      "SELECT count(*)::int as c FROM solicitudes_registro WHERE email = 'integration-failclosed@cliente.cl'",
    );
    expect(rows.rows[0].c).toBe(1);
  });

  it('Scenario 2: cloud-armor cascade — header X-Cloud-Armor-Banned no es inspeccionado por el middleware (documentación)', async () => {
    // El middleware NO inspecciona headers de Cloud Armor. En prod, Cloud
    // Armor bloquea ANTES de que el request llegue a Cloud Run. Si por
    // alguna razón un request con header sintético llega al middleware, el
    // middleware lo procesa normalmente (incrementa counter, sigue al handler).
    // Test documenta este invariante: el middleware NO tiene lógica
    // condicional sobre headers cloud-armor — la cascade es estructural.
    //
    // Ver docs/qa/rate-limit-cascade.md §signup-request layer para la cascada
    // completa y por qué la separación de capas es deliberada.
    const res = await app.request('/api/v1/signup-request', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '5.5.5.5',
        // Header sintético — Cloud Armor real NUNCA lo envía; lo agregamos
        // para verificar que el middleware no se confunde con headers
        // adicionales.
        'X-Cloud-Armor-Banned': 'true',
      },
      body: JSON.stringify({
        email: 'integration-cascade@cliente.cl',
        nombreCompleto: 'Cascade Tester',
      }),
    });
    expect(res.status).toBe(202);

    // Counter Redis incrementó normalmente (el header NO es inspeccionado).
    const keys = await redis?.keys('rl:signup-request:5.5.5.5');
    expect(keys?.length).toBe(1);
  });
});
