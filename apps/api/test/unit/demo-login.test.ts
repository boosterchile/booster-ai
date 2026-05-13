import type { Auth } from 'firebase-admin/auth';
import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests para `POST /demo/login` (modo demo subdominio).
 *
 * El endpoint depende de `appConfig.DEMO_MODE_ACTIVATED` que se evalúa en
 * runtime dentro del handler. Como `config.ts` se importa con efecto
 * lateral (parseEnv del módulo), usamos `vi.resetModules()` + reasignación
 * de env vars + reimport entre tests para alternar el flag sin shared
 * state.
 */

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.SERVICE_NAME = 'booster-ai-api';
  process.env.SERVICE_VERSION = '0.0.0-test';
  process.env.LOG_LEVEL = 'error';
  process.env.GOOGLE_CLOUD_PROJECT = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.REDIS_HOST = 'localhost';
  process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:5173';
  process.env.FIREBASE_PROJECT_ID = 'test';
  process.env.API_AUDIENCE = 'https://api.boosterchile.com';
  process.env.ALLOWED_CALLER_SA = 'caller@booster-ai.iam.gserviceaccount.com';
});

beforeEach(() => {
  vi.resetModules();
});

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  child: () => noopLogger,
} as unknown as Parameters<
  typeof import('../../src/routes/demo-login.js').createDemoLoginRoutes
>[0]['logger'];

/**
 * Stub para queries con innerJoin. El handler de demo-login arma cadenas
 * `db.select(...).from(...).innerJoin(...).innerJoin(...).where(...).limit(N)`
 * (3 niveles de join para shipper/carrier, 2 para conductor). El stub
 * intercepta toda la cadena y devuelve la primera fila del queue al
 * `.limit()`.
 */
function makeJoinDbStub(rows: Array<Record<string, unknown>>) {
  const limit = vi.fn(() => Promise.resolve(rows));
  const where = vi.fn(() => ({ limit }));
  const innerJoin2 = vi.fn(() => ({ innerJoin: innerJoin2, where }));
  const innerJoin1 = vi.fn(() => ({ innerJoin: innerJoin2, where }));
  const from = vi.fn(() => ({ innerJoin: innerJoin1, where }));
  const select = vi.fn(() => ({ from }));
  return {
    db: { select } as unknown as Parameters<
      typeof import('../../src/routes/demo-login.js').createDemoLoginRoutes
    >[0]['db'],
  };
}

function makeFirebaseStub(opts: { tokenFails?: boolean } = {}) {
  const createCustomToken = opts.tokenFails
    ? vi.fn().mockRejectedValue(new Error('firebase boom'))
    : vi.fn().mockResolvedValue('custom-token-xyz');
  return {
    auth: {
      createCustomToken,
    } as unknown as Auth,
    spies: { createCustomToken },
  };
}

async function buildApp(
  db: Parameters<typeof import('../../src/routes/demo-login.js').createDemoLoginRoutes>[0]['db'],
  firebaseAuth: Auth,
) {
  const { createDemoLoginRoutes } = await import('../../src/routes/demo-login.js');
  const app = new Hono();
  app.route('/demo', createDemoLoginRoutes({ db, firebaseAuth, logger: noopLogger }));
  return app;
}

describe('POST /demo/login', () => {
  it('flag DEMO_MODE_ACTIVATED=false → 404 not_found', async () => {
    process.env.DEMO_MODE_ACTIVATED = 'false';
    const { db } = makeJoinDbStub([]);
    const fb = makeFirebaseStub();
    const app = await buildApp(db, fb.auth);
    const res = await app.request('/demo/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ persona: 'shipper' }),
    });
    expect(res.status).toBe(404);
    expect(fb.spies.createCustomToken).not.toHaveBeenCalled();
  });

  it('persona inválida → 400 validation', async () => {
    process.env.DEMO_MODE_ACTIVATED = 'true';
    const { db } = makeJoinDbStub([]);
    const fb = makeFirebaseStub();
    const app = await buildApp(db, fb.auth);
    const res = await app.request('/demo/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ persona: 'hacker' }),
    });
    expect(res.status).toBe(400);
    expect(fb.spies.createCustomToken).not.toHaveBeenCalled();
  });

  it('payload sin persona → 400 validation', async () => {
    process.env.DEMO_MODE_ACTIVATED = 'true';
    const { db } = makeJoinDbStub([]);
    const fb = makeFirebaseStub();
    const app = await buildApp(db, fb.auth);
    const res = await app.request('/demo/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('flag ON pero demo no seedeado (DB vacío) → 503 demo_not_seeded', async () => {
    process.env.DEMO_MODE_ACTIVATED = 'true';
    const { db } = makeJoinDbStub([]);
    const fb = makeFirebaseStub();
    const app = await buildApp(db, fb.auth);
    const res = await app.request('/demo/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ persona: 'shipper' }),
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('demo_not_seeded');
    expect(fb.spies.createCustomToken).not.toHaveBeenCalled();
  });

  it('flag ON + user demo shipper existe → 200 con custom_token + redirect_to /app', async () => {
    process.env.DEMO_MODE_ACTIVATED = 'true';
    const { db } = makeJoinDbStub([{ userId: 'u-shipper-1', firebaseUid: 'fb-shipper-1' }]);
    const fb = makeFirebaseStub();
    const app = await buildApp(db, fb.auth);
    const res = await app.request('/demo/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ persona: 'shipper' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      custom_token: string;
      persona: string;
      redirect_to: string;
    };
    expect(body.custom_token).toBe('custom-token-xyz');
    expect(body.persona).toBe('shipper');
    expect(body.redirect_to).toBe('/app');
    // El custom token mint usa el UID resolved + claims is_demo + persona.
    expect(fb.spies.createCustomToken).toHaveBeenCalledWith('fb-shipper-1', {
      is_demo: true,
      persona: 'shipper',
    });
  });

  it('persona=carrier → redirect_to /app', async () => {
    process.env.DEMO_MODE_ACTIVATED = 'true';
    const { db } = makeJoinDbStub([{ userId: 'u-carrier-1', firebaseUid: 'fb-carrier-1' }]);
    const fb = makeFirebaseStub();
    const app = await buildApp(db, fb.auth);
    const res = await app.request('/demo/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ persona: 'carrier' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { redirect_to: string };
    expect(body.redirect_to).toBe('/app');
  });

  it('persona=conductor con firebase real → redirect_to /app/conductor/modo', async () => {
    process.env.DEMO_MODE_ACTIVATED = 'true';
    const { db } = makeJoinDbStub([{ userId: 'u-driver-1', firebaseUid: 'fb-driver-1' }]);
    const fb = makeFirebaseStub();
    const app = await buildApp(db, fb.auth);
    const res = await app.request('/demo/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ persona: 'conductor' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { redirect_to: string };
    expect(body.redirect_to).toBe('/app/conductor/modo');
  });

  it('persona=conductor con firebase placeholder pending-rut → 503 (no emite token)', async () => {
    process.env.DEMO_MODE_ACTIVATED = 'true';
    // El seed inicial deja el conductor con firebase_uid placeholder;
    // si el startup hook todavía no promovió, /demo/login responde 503.
    const { db } = makeJoinDbStub([{ userId: 'u-driver-1', firebaseUid: 'pending-rut:123456785' }]);
    const fb = makeFirebaseStub();
    const app = await buildApp(db, fb.auth);
    const res = await app.request('/demo/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ persona: 'conductor' }),
    });
    expect(res.status).toBe(503);
    expect(fb.spies.createCustomToken).not.toHaveBeenCalled();
  });

  it('persona=stakeholder → redirect_to /app/stakeholder/zonas', async () => {
    process.env.DEMO_MODE_ACTIVATED = 'true';
    const { db } = makeJoinDbStub([{ userId: 'u-stake-1', firebaseUid: 'fb-stake-1' }]);
    const fb = makeFirebaseStub();
    const app = await buildApp(db, fb.auth);
    const res = await app.request('/demo/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ persona: 'stakeholder' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { redirect_to: string; persona: string };
    expect(body.persona).toBe('stakeholder');
    expect(body.redirect_to).toBe('/app/stakeholder/zonas');
  });

  it('createCustomToken falla → 502 firebase_error', async () => {
    process.env.DEMO_MODE_ACTIVATED = 'true';
    const { db } = makeJoinDbStub([{ userId: 'u-shipper-1', firebaseUid: 'fb-shipper-1' }]);
    const fb = makeFirebaseStub({ tokenFails: true });
    const app = await buildApp(db, fb.auth);
    const res = await app.request('/demo/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ persona: 'shipper' }),
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('firebase_error');
  });
});
