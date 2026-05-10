import { Hono } from 'hono';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
});

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: noop,
  child: () => noopLogger,
} as never;

interface DbQueues {
  inserts?: unknown[][];
  deletes?: unknown[][];
}

function makeDb(queues: DbQueues = {}) {
  const inserts = [...(queues.inserts ?? [])];
  const deletes = [...(queues.deletes ?? [])];

  const buildInsertChain = () => {
    const chain: Record<string, unknown> = {
      values: vi.fn(() => chain),
      onConflictDoUpdate: vi.fn(async () => inserts.shift() ?? []),
    };
    return chain;
  };

  const buildDeleteChain = () => ({
    where: vi.fn(() => ({
      returning: vi.fn(async () => deletes.shift() ?? []),
    })),
  });

  return {
    insert: vi.fn(() => buildInsertChain()),
    delete: vi.fn(() => buildDeleteChain()),
  };
}

const USER_ID = 'user-uuid-1';
const VALID_USER_CTX = JSON.stringify({ user: { id: USER_ID } });

const VALID_BODY = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc-token',
  keys: {
    p256dh: 'p256dh-key-base64',
    auth: 'auth-key-base64',
  },
};

async function buildPrivApp(db: unknown) {
  const { createMePushSubscriptionRoutes } = await import('../../src/routes/webpush.js');
  const app = new Hono();
  app.use('/me/*', async (c, next) => {
    const ctx = c.req.header('x-test-userctx');
    if (ctx) {
      c.set('userContext', JSON.parse(ctx));
    }
    await next();
  });
  app.route(
    '/me/push-subscription',
    createMePushSubscriptionRoutes({ db: db as never, logger: noopLogger }),
  );
  return app;
}

async function buildPublicApp(opts: { vapidPublicKey?: string }) {
  const { createWebpushPublicRoutes } = await import('../../src/routes/webpush.js');
  const app = new Hono();
  app.route('/webpush', createWebpushPublicRoutes(opts));
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /me/push-subscription', () => {
  it('sin auth → 401', async () => {
    const app = await buildPrivApp(makeDb());
    const res = await app.request('/me/push-subscription', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_BODY),
    });
    expect(res.status).toBe(401);
  });

  it('body inválido (zod) → 400', async () => {
    const app = await buildPrivApp(makeDb());
    const res = await app.request('/me/push-subscription', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-userctx': VALID_USER_CTX },
      body: JSON.stringify({ endpoint: 'no-es-url' }),
    });
    expect(res.status).toBe(400);
  });

  it('endpoint URL inválida → 400', async () => {
    const app = await buildPrivApp(makeDb());
    const res = await app.request('/me/push-subscription', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-userctx': VALID_USER_CTX },
      body: JSON.stringify({
        endpoint: 'not-a-url',
        keys: { p256dh: 'p', auth: 'a' },
      }),
    });
    expect(res.status).toBe(400);
  });

  it('happy path: 200 ok=true tras UPSERT', async () => {
    const db = makeDb({ inserts: [[]] });
    const app = await buildPrivApp(db);
    const res = await app.request('/me/push-subscription', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-userctx': VALID_USER_CTX },
      body: JSON.stringify(VALID_BODY),
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { ok: boolean }).toEqual({ ok: true });
  });

  it('user-agent header se captura (logueado)', async () => {
    const db = makeDb({ inserts: [[]] });
    const app = await buildPrivApp(db);
    await app.request('/me/push-subscription', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-userctx': VALID_USER_CTX,
        'user-agent': 'Mozilla/5.0 Test',
      },
      body: JSON.stringify(VALID_BODY),
    });
    expect(noopLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ endpointHost: 'fcm.googleapis.com' }),
      'push subscription registrada',
    );
  });
});

describe('DELETE /me/push-subscription', () => {
  it('sin auth → 401', async () => {
    const app = await buildPrivApp(makeDb());
    const res = await app.request('/me/push-subscription', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: VALID_BODY.endpoint }),
    });
    expect(res.status).toBe(401);
  });

  it('body inválido → 400', async () => {
    const app = await buildPrivApp(makeDb());
    const res = await app.request('/me/push-subscription', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', 'x-test-userctx': VALID_USER_CTX },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('endpoint no existe → 200 removed=0', async () => {
    const db = makeDb({ deletes: [[]] });
    const app = await buildPrivApp(db);
    const res = await app.request('/me/push-subscription', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', 'x-test-userctx': VALID_USER_CTX },
      body: JSON.stringify({ endpoint: VALID_BODY.endpoint }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { removed: number };
    expect(body.removed).toBe(0);
  });

  it('happy path: removed=1', async () => {
    const db = makeDb({
      deletes: [[{ id: 'sub-id', userId: USER_ID }]],
    });
    const app = await buildPrivApp(db);
    const res = await app.request('/me/push-subscription', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', 'x-test-userctx': VALID_USER_CTX },
      body: JSON.stringify({ endpoint: VALID_BODY.endpoint }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { removed: number };
    expect(body.removed).toBe(1);
  });

  it('endpoint pertenece a OTRO user → loggea warn + 200 removed', async () => {
    const db = makeDb({
      deletes: [[{ id: 'sub-id', userId: 'OTRO-user' }]],
    });
    const app = await buildPrivApp(db);
    const res = await app.request('/me/push-subscription', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', 'x-test-userctx': VALID_USER_CTX },
      body: JSON.stringify({ endpoint: VALID_BODY.endpoint }),
    });
    expect(res.status).toBe(200);
    expect(noopLogger.warn).toHaveBeenCalled();
  });
});

describe('GET /webpush/vapid-public-key (público)', () => {
  it('sin vapidPublicKey configured → 503 webpush_disabled', async () => {
    const app = await buildPublicApp({});
    const res = await app.request('/webpush/vapid-public-key');
    expect(res.status).toBe(503);
  });

  it('con vapidPublicKey → 200 con public_key', async () => {
    const app = await buildPublicApp({ vapidPublicKey: 'BPubKeyXYZ' });
    const res = await app.request('/webpush/vapid-public-key');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { public_key: string };
    expect(body.public_key).toBe('BPubKeyXYZ');
  });
});
