import { Hono } from 'hono';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { hashClaveNumerica } from '../../src/services/clave-numerica.js';

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
  typeof import('../../src/routes/me-clave-numerica.js').createMeClaveNumericaRoutes
>[0]['logger'];

const FB_UID = 'fb-uid-abc';
const USER_ID = 'user-uuid-xyz';

interface UserRow {
  id: string;
  claveNumericaHash: string | null;
}

function makeDbStub(opts: { userRow: UserRow | null }) {
  const queue: Array<UserRow[]> = [opts.userRow ? [opts.userRow] : []];
  const limit = vi.fn(() => Promise.resolve(queue.shift() ?? []));
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  const updateWhere = vi.fn(() => Promise.resolve(undefined));
  const set = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set }));

  return {
    db: { select, update } as unknown as Parameters<
      typeof import('../../src/routes/me-clave-numerica.js').createMeClaveNumericaRoutes
    >[0]['db'],
    spies: { set, updateWhere },
  };
}

async function buildApp(
  db: Parameters<
    typeof import('../../src/routes/me-clave-numerica.js').createMeClaveNumericaRoutes
  >[0]['db'],
  claims: { uid: string; email?: string } | null,
) {
  const { createMeClaveNumericaRoutes } = await import('../../src/routes/me-clave-numerica.js');
  const app = new Hono();
  app.use('/me/*', async (c, next) => {
    if (claims) {
      c.set('firebaseClaims', {
        uid: claims.uid,
        email: claims.email,
        emailVerified: true,
        name: undefined,
        picture: undefined,
        custom: {},
      });
    }
    await next();
  });
  app.route('/me', createMeClaveNumericaRoutes({ db, logger: noopLogger }));
  return app;
}

describe('POST /me/clave-numerica (ADR-035 Wave 4 PR 3)', () => {
  it('sin firebaseClaims → 401', async () => {
    const { db } = makeDbStub({ userRow: { id: USER_ID, claveNumericaHash: null } });
    const app = await buildApp(db, null);
    const res = await app.request('/me/clave-numerica', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clave_anterior: null, clave_nueva: '123456' }),
    });
    expect(res.status).toBe(401);
  });

  it('user no existe en DB por firebase_uid → 404', async () => {
    const { db } = makeDbStub({ userRow: null });
    const app = await buildApp(db, { uid: FB_UID });
    const res = await app.request('/me/clave-numerica', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clave_anterior: null, clave_nueva: '123456' }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('user_not_found');
  });

  it('first-rotation: user sin clave + clave_anterior=null → 204', async () => {
    const { db, spies } = makeDbStub({ userRow: { id: USER_ID, claveNumericaHash: null } });
    const app = await buildApp(db, { uid: FB_UID });
    const res = await app.request('/me/clave-numerica', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clave_anterior: null, clave_nueva: '123456' }),
    });
    expect(res.status).toBe(204);
    expect(spies.set).toHaveBeenCalled();
  });

  it('rotation: user con clave + clave_anterior correcta → 204', async () => {
    const oldHash = hashClaveNumerica('111111');
    const { db, spies } = makeDbStub({ userRow: { id: USER_ID, claveNumericaHash: oldHash } });
    const app = await buildApp(db, { uid: FB_UID });
    const res = await app.request('/me/clave-numerica', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clave_anterior: '111111', clave_nueva: '222222' }),
    });
    expect(res.status).toBe(204);
    expect(spies.set).toHaveBeenCalled();
  });

  it('rotation: clave_anterior incorrecta → 403', async () => {
    const oldHash = hashClaveNumerica('111111');
    const { db, spies } = makeDbStub({ userRow: { id: USER_ID, claveNumericaHash: oldHash } });
    const app = await buildApp(db, { uid: FB_UID });
    const res = await app.request('/me/clave-numerica', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clave_anterior: '999999', clave_nueva: '222222' }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_clave_anterior');
    expect(spies.set).not.toHaveBeenCalled();
  });

  it('rotation: clave_anterior=null pero user con clave seteada → 403', async () => {
    const oldHash = hashClaveNumerica('111111');
    const { db, spies } = makeDbStub({ userRow: { id: USER_ID, claveNumericaHash: oldHash } });
    const app = await buildApp(db, { uid: FB_UID });
    const res = await app.request('/me/clave-numerica', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clave_anterior: null, clave_nueva: '222222' }),
    });
    expect(res.status).toBe(403);
    expect(spies.set).not.toHaveBeenCalled();
  });

  it('clave_nueva de 5 dígitos → 400 (Zod validation)', async () => {
    const { db } = makeDbStub({ userRow: { id: USER_ID, claveNumericaHash: null } });
    const app = await buildApp(db, { uid: FB_UID });
    const res = await app.request('/me/clave-numerica', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clave_anterior: null, clave_nueva: '12345' }),
    });
    expect(res.status).toBe(400);
  });

  it('clave_nueva con letras → 400 (Zod validation)', async () => {
    const { db } = makeDbStub({ userRow: { id: USER_ID, claveNumericaHash: null } });
    const app = await buildApp(db, { uid: FB_UID });
    const res = await app.request('/me/clave-numerica', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clave_anterior: null, clave_nueva: 'abc123' }),
    });
    expect(res.status).toBe(400);
  });
});
