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
/**
 * Intento con PIN incorrecto → el handler stub responde 401. Es lo que el
 * rate-limit debe contar: la protección es anti-brute-force, y desde el
 * reset-on-success per-RUT un 2xx **limpia** el counter (un 4xx lo mantiene).
 * Contar éxitos dejaría afuera al usuario legítimo tras 5 logins correctos, y
 * permitiría que un tercero que conoce un RUT ajeno lo bloquee acumulando
 * intentos contra la víctima.
 */
const REQ_PIN_MALO: RequestInit = {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ rut: VALID_RUT, pin: 'wrong' }),
};
const logger = createLogger({ service: 't8', version: '0', level: 'silent', pretty: false });
const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));

const INITIAL_CONNECT_ATTEMPTS = 10;
const INITIAL_CONNECT_BACKOFF_MS = 100;

/**
 * Conecta al Redis recién levantado, reintentando la conexión inicial.
 *
 * El contenedor avisa «Ready to accept connections» antes de que el puerto
 * publicado en el host acepte conexiones: con runtimes que redirigen puertos
 * desde una VM (colima, Docker Desktop) el primer intento puede recibir
 * ECONNREFUSED durante unas decenas de ms. Con `lazyConnect`, `connect()`
 * rechaza al primer cierre sin aplicar `retryStrategy`, así que el reintento
 * va acá. Cada intento usa un cliente nuevo; si se agotan, se propaga el
 * último error. Los escenarios siguen usando el cliente con las mismas
 * opciones de siempre.
 */
async function connectToFreshContainer(host: string, port: number): Promise<Redis> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= INITIAL_CONNECT_ATTEMPTS; attempt += 1) {
    const client = new Redis({
      host,
      port,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      commandTimeout: 1500,
      lazyConnect: true,
      retryStrategy: (n) => Math.min(n * 100, 1000),
    });
    client.on('error', () => undefined);
    try {
      await client.connect();
      await client.ping();
      return client;
    } catch (err) {
      lastError = err;
      client.disconnect();
      await wait(INITIAL_CONNECT_BACKOFF_MS);
    }
  }
  throw new Error(
    `No se pudo conectar al Redis de prueba en ${host}:${port} tras ${INITIAL_CONNECT_ATTEMPTS} intentos`,
    { cause: lastError },
  );
}

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
  // Stub de auth: `pin: 'wrong'` → 401 (intento fallido), cualquier otro → 200.
  // `c.req.json()` lo memoiza Hono, así que releerlo tras el middleware es seguro.
  app.post('/activate', async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const pin =
      typeof body === 'object' && body !== null && 'pin' in body
        ? (body as { pin?: unknown }).pin
        : undefined;
    return pin === 'wrong' ? c.json({ error: 'invalid_pin' }, 401) : c.json({ ok: true }, 200);
  });
  return app;
}

describe('T8 SEC-001 — rate-limit-pin contra Redis REAL via testcontainers', () => {
  let container: StartedRedisContainer | undefined;
  let redis: Redis | undefined;
  let app: Hono;

  beforeEach(async () => {
    container = await new RedisContainer('redis:7-alpine').start();
    redis = await connectToFreshContainer(container.getHost(), container.getMappedPort(6379));
    app = buildApp(redis);
  }, 60_000);

  afterEach(async () => {
    redis?.disconnect();
    await container?.stop().catch(() => undefined);
    redis = undefined;
    container = undefined;
  });

  it('Scenario 1: Redis up — 5 intentos FALLIDOS pasan, 6º retorna 429 scope=rut', async () => {
    for (let i = 1; i <= 5; i += 1) {
      expect((await app.request('/activate', REQ_PIN_MALO)).status, `request #${i}`).toBe(401);
    }
    const sixth = await app.request('/activate', REQ_PIN_MALO);
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get('X-RateLimit-Scope')).toBe('rut');
  });

  it('Scenario 1b: reset-on-success — un 2xx limpia el counter per-RUT (Redis real)', async () => {
    // 4 fallos: queda a uno del límite sin haberlo cruzado.
    for (let i = 1; i <= 4; i += 1) {
      expect((await app.request('/activate', REQ_PIN_MALO)).status, `fallo #${i}`).toBe(401);
    }
    // Auth exitosa → borra el counter per-RUT (el per-IP NO se resetea).
    expect((await app.request('/activate', REQ)).status).toBe(200);

    // Sin el reset, el 6º intento global sería 429. Con reset, la ventana
    // arranca de cero: 5 fallos nuevos vuelven a pasar y recién el 6º corta.
    for (let i = 1; i <= 5; i += 1) {
      expect((await app.request('/activate', REQ_PIN_MALO)).status, `post-reset #${i}`).toBe(401);
    }
    const bloqueado = await app.request('/activate', REQ_PIN_MALO);
    expect(bloqueado.status).toBe(429);
    expect(bloqueado.headers.get('X-RateLimit-Scope')).toBe('rut');
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

  it('Scenario 3: TCP socket destroy mid-flight — ioredis auto-reconnect recupera 200 sin restart de app', async () => {
    expect((await app.request('/activate', REQ)).status).toBe(200);

    redis?.stream?.destroy();
    await wait(100);

    for (let i = 0; i < 30; i += 1) {
      if (redis?.status === 'ready') {
        break;
      }
      await wait(200);
    }

    expect((await app.request('/activate', REQ)).status).toBe(200);
  }, 60_000);
});
