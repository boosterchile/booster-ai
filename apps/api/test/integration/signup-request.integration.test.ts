import { createLogger } from '@booster-ai/logger';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { Hono } from 'hono';
import Redis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRateLimitSignupMiddleware } from '../../src/middleware/rate-limit-signup.js';
import { createSignupRequestRoutes } from '../../src/routes/signup-request.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * T9a SEC-001 Sprint 2b — Integration tests POST /api/v1/signup-request
 * (sec-001-cierre §3 H1.2 SC-1.2.4 partial + SC-1.2.5 partial).
 *
 * Cubre 3 cases end-to-end usando code real (middleware + route + service +
 * Drizzle ORM real contra Postgres + Redis real via testcontainers):
 *
 *   1. **happy**: POST valid → 202 + row INSERT en `solicitudes_registro`
 *      con `estado=pendiente_aprobacion`.
 *   2. **enumeration defense (SC-1.2.5)**: POST email ya en `users` → 202
 *      con response idéntico al case 1 + NO row insertado.
 *   3. **rate-limit (SC-1.2.5)**: 6 requests mismo IP → 6º 429 con
 *      `Retry-After: 900` + `X-RateLimit-Scope: ip`.
 *
 * Redis testcontainers (pattern redis-fail-closed-real) garantiza Redis real
 * sin mocks. Pool Postgres via TEST_DATABASE_URL + migrations aplicadas en
 * globalSetup (incluye 0039 solicitudes_registro).
 */
const logger = createLogger({
  service: 'signup-request-integration',
  version: '0',
  level: 'silent',
  pretty: false,
});

describe('integration: POST /api/v1/signup-request (SC-1.2.4 + SC-1.2.5 partial)', () => {
  let dbHandle: TestDbHandle;
  let container: StartedRedisContainer;
  let redis: Redis;
  let app: Hono;

  beforeAll(async () => {
    dbHandle = createTestDb();

    container = await new RedisContainer('redis:7-alpine').start();
    redis = new Redis({
      host: container.getHost(),
      port: container.getMappedPort(6379),
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      commandTimeout: 1500,
      lazyConnect: true,
    });
    redis.on('error', () => undefined);
    await redis.connect();
    await redis.ping();

    app = new Hono();
    app.use(
      '/api/v1/signup-request',
      createRateLimitSignupMiddleware({
        redis,
        logger,
        limitPerIp: 5,
        windowSeconds: 900,
      }),
    );
    app.route('/api/v1/signup-request', createSignupRequestRoutes({ db: dbHandle.db, logger }));
  }, 120_000);

  afterAll(async () => {
    redis?.disconnect();
    await container?.stop().catch(() => undefined);
    await dbHandle?.pool.end();
  });

  beforeEach(async () => {
    await dbHandle.pool.query('DELETE FROM solicitudes_registro');
    await dbHandle.pool.query("DELETE FROM usuarios WHERE email LIKE 'integration-test-%'");
    await redis.flushdb();
  });

  it('happy: POST valid → 202 + row pendiente_aprobacion (SC-1.2.4)', async () => {
    const res = await app.request('/api/v1/signup-request', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.1.1.1' },
      body: JSON.stringify({
        email: 'integration-test-happy@cliente.cl',
        nombreCompleto: 'Cliente Integration',
      }),
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    const rows = await dbHandle.pool.query<{
      email: string;
      nombre_completo: string;
      estado: string;
    }>(
      "SELECT email, nombre_completo, estado FROM solicitudes_registro WHERE email = 'integration-test-happy@cliente.cl'",
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].estado).toBe('pendiente_aprobacion');
    expect(rows.rows[0].nombre_completo).toBe('Cliente Integration');
  });

  it('enumeration defense: email ya en users → 202 idéntico + NO row insertado (SC-1.2.5)', async () => {
    // Seed: user existente con el email a probar.
    await dbHandle.pool.query(
      `INSERT INTO usuarios (firebase_uid, email, nombre_completo, estado)
       VALUES ($1, $2, $3, 'activo')`,
      ['fb-uid-existing', 'integration-test-existing@cliente.cl', 'Existente'],
    );

    const res = await app.request('/api/v1/signup-request', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '2.2.2.2' },
      body: JSON.stringify({
        email: 'integration-test-existing@cliente.cl',
        nombreCompleto: 'Re Intento',
      }),
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    // Anti-enumeration: NO row en solicitudes_registro para ese email.
    const rows = await dbHandle.pool.query<{ c: number }>(
      "SELECT count(*)::int as c FROM solicitudes_registro WHERE email = 'integration-test-existing@cliente.cl'",
    );
    expect(rows.rows[0].c).toBe(0);
  });

  it('rate-limit: 6 requests mismo IP → 6º 429 + Retry-After:900 (SC-1.2.5)', async () => {
    for (let i = 1; i <= 5; i += 1) {
      const r = await app.request('/api/v1/signup-request', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '9.9.9.9' },
        body: JSON.stringify({
          email: `integration-test-rl-${i}@cliente.cl`,
          nombreCompleto: `Rate Test ${i}`,
        }),
      });
      expect(r.status, `request #${i}`).toBe(202);
    }

    const sixth = await app.request('/api/v1/signup-request', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '9.9.9.9' },
      body: JSON.stringify({
        email: 'integration-test-rl-6@cliente.cl',
        nombreCompleto: 'Rate Test 6',
      }),
    });
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get('Retry-After')).toBe('900');
    expect(sixth.headers.get('X-RateLimit-Scope')).toBe('ip');
    const json = (await sixth.json()) as { error: string };
    expect(json.error).toBe('too_many_attempts');

    // Verify NO row insertado por la 6ª request (rate-limit fired antes
    // del handler, NO consume el counter de INSERTs).
    const sixthRow = await dbHandle.pool.query<{ c: number }>(
      "SELECT count(*)::int as c FROM solicitudes_registro WHERE email = 'integration-test-rl-6@cliente.cl'",
    );
    expect(sixthRow.rows[0].c).toBe(0);
  });
});
