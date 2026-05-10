import { Hono } from 'hono';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.SERVICE_NAME = 'booster-ai-api';
  process.env.SERVICE_VERSION = '0.0.0-test';
  process.env.LOG_LEVEL = 'error';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.GOOGLE_CLOUD_PROJECT = 'test';
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
} as unknown as Parameters<
  typeof import('../../src/routes/me-consents.js').createMeConsentsRoutes
>[0]['logger'];

/**
 * DB stub que matchea el patrón fluent de Drizzle. Soporta select/insert/update.
 * Cada chain consume un resultado de las queues correspondientes.
 */
interface DbQueues {
  selects?: unknown[][];
  inserts?: unknown[][];
  updates?: unknown[][];
}

function makeDbStub(initial: DbQueues = {}) {
  const selects = [...(initial.selects ?? [])];
  const inserts = [...(initial.inserts ?? [])];
  const updates = [...(initial.updates ?? [])];

  const buildSelectChain = () => {
    const chain: Record<string, unknown> = {
      from: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      where: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(async () => selects.shift() ?? []),
    };
    chain.then = (resolve: (v: unknown) => unknown) => {
      const result = selects.shift() ?? [];
      return Promise.resolve(resolve(result));
    };
    return chain;
  };

  const buildInsertChain = () => ({
    values: vi.fn(() => ({
      returning: vi.fn(async () => inserts.shift() ?? []),
    })),
  });

  const buildUpdateChain = () => ({
    set: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(async () => updates.shift() ?? []),
      })),
    })),
  });

  return {
    select: vi.fn(() => buildSelectChain()),
    insert: vi.fn(() => buildInsertChain()),
    update: vi.fn(() => buildUpdateChain()),
  };
}

const FB_UID = 'fb-uid-grantor';
const USER_ID = 'user-uuid-grantor';

const validClaimsHeader = JSON.stringify({ uid: FB_UID, email: 'a@b.c' });

async function buildApp(db: unknown) {
  const { createMeConsentsRoutes } = await import('../../src/routes/me-consents.js');
  const app = new Hono();
  app.use('/me/*', async (c, next) => {
    const claimsHeader = c.req.header('x-test-claims');
    if (claimsHeader) {
      const parsed = JSON.parse(claimsHeader) as { uid: string; email?: string };
      c.set('firebaseClaims', {
        uid: parsed.uid,
        email: parsed.email,
        emailVerified: false,
        name: undefined,
        picture: undefined,
        custom: {},
      });
    }
    await next();
  });
  app.route('/me/consents', createMeConsentsRoutes({ db: db as never, logger: noopLogger }));
  return app;
}

const validBody = {
  stakeholder_id: '11111111-1111-1111-1111-111111111111',
  scope_type: 'organizacion',
  scope_id: '22222222-2222-2222-2222-222222222222',
  data_categories: ['emisiones_carbono', 'certificados'],
  consent_document_url: 'https://docs.boosterchile.com/c/abc.pdf',
};

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /me/consents', () => {
  it('rechaza request sin claims con 500', async () => {
    const db = makeDbStub({});
    const app = await buildApp(db);
    const res = await app.request('/me/consents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(500);
  });

  it('user no registrado en BD → 404', async () => {
    const db = makeDbStub({ selects: [[]] }); // resolveUserId encuentra 0
    const app = await buildApp(db);
    const res = await app.request('/me/consents', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-claims': validClaimsHeader },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('user_not_registered');
  });

  it('user sin role dueño/admin en ninguna empresa → 403 forbidden_scope_authority', async () => {
    const db = makeDbStub({
      selects: [
        [{ id: USER_ID }], // resolveUserId
        [{ role: 'conductor', status: 'activa' }], // memberships (no dueño/admin)
      ],
    });
    const app = await buildApp(db);
    const res = await app.request('/me/consents', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-claims': validClaimsHeader },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('forbidden_scope_authority');
  });

  it('expires_at en el pasado → 400 expires_at_must_be_future', async () => {
    const db = makeDbStub({
      selects: [[{ id: USER_ID }], [{ role: 'admin', status: 'activa' }]],
    });
    const app = await buildApp(db);
    const res = await app.request('/me/consents', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-claims': validClaimsHeader },
      body: JSON.stringify({ ...validBody, expires_at: '2020-01-01T00:00:00Z' }),
    });
    expect(res.status).toBe(400);
  });

  it('happy path: user dueño + body válido → 201 con consent_id', async () => {
    const db = makeDbStub({
      selects: [[{ id: USER_ID }], [{ role: 'dueno', status: 'activa' }]],
      inserts: [[{ id: 'new-consent-uuid' }]],
    });
    const app = await buildApp(db);
    const res = await app.request('/me/consents', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-claims': validClaimsHeader },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { consent_id: string };
    expect(body.consent_id).toBe('new-consent-uuid');
  });

  it('rechaza data_categories vacío con 400 (zod validator)', async () => {
    const db = makeDbStub({});
    const app = await buildApp(db);
    const res = await app.request('/me/consents', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-claims': validClaimsHeader },
      body: JSON.stringify({ ...validBody, data_categories: [] }),
    });
    expect(res.status).toBe(400);
  });

  it('rechaza consent_document_url no-HTTPS con 400 (zod refine)', async () => {
    const db = makeDbStub({});
    const app = await buildApp(db);
    const res = await app.request('/me/consents', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-claims': validClaimsHeader },
      body: JSON.stringify({ ...validBody, consent_document_url: 'http://insecure.test/c.pdf' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /me/consents/:id/revoke', () => {
  it('user no registrado → 404 user_not_registered', async () => {
    const db = makeDbStub({ selects: [[]] });
    const app = await buildApp(db);
    const res = await app.request('/me/consents/c1/revoke', {
      method: 'PATCH',
      headers: { 'x-test-claims': validClaimsHeader },
    });
    expect(res.status).toBe(404);
  });

  it('consent inexistente → 404 consent_not_found', async () => {
    const db = makeDbStub({
      selects: [
        [{ id: USER_ID }], // resolveUserId
        [], // consent SELECT pre-check
      ],
    });
    const app = await buildApp(db);
    const res = await app.request('/me/consents/c1/revoke', {
      method: 'PATCH',
      headers: { 'x-test-claims': validClaimsHeader },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('consent_not_found');
  });

  it('consent existe pero de otro otorgante → 403 forbidden_not_grantor', async () => {
    const db = makeDbStub({
      selects: [[{ id: USER_ID }], [{ grantedByUserId: 'OTRO-USER' }]],
    });
    const app = await buildApp(db);
    const res = await app.request('/me/consents/c1/revoke', {
      method: 'PATCH',
      headers: { 'x-test-claims': validClaimsHeader },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('forbidden_not_grantor');
  });

  it('happy path: revocación exitosa → 200 { revoked: true }', async () => {
    const db = makeDbStub({
      selects: [[{ id: USER_ID }], [{ grantedByUserId: USER_ID }]],
      updates: [[{ id: 'c1' }]],
    });
    const app = await buildApp(db);
    const res = await app.request('/me/consents/c1/revoke', {
      method: 'PATCH',
      headers: { 'x-test-claims': validClaimsHeader },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { revoked: boolean };
    expect(body.revoked).toBe(true);
  });

  it('idempotente: ya revocado → 200 { already_revoked: true }', async () => {
    const db = makeDbStub({
      selects: [
        [{ id: USER_ID }],
        [{ grantedByUserId: USER_ID }],
        [{ grantedByUserId: USER_ID, revokedAt: new Date() }], // service revokeConsent's second SELECT
      ],
      updates: [[]], // UPDATE no afecta filas (ya revocado)
    });
    const app = await buildApp(db);
    const res = await app.request('/me/consents/c1/revoke', {
      method: 'PATCH',
      headers: { 'x-test-claims': validClaimsHeader },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { already_revoked?: boolean };
    expect(body.already_revoked).toBe(true);
  });
});

describe('GET /me/consents', () => {
  it('user no registrado → 404', async () => {
    const db = makeDbStub({ selects: [[]] });
    const app = await buildApp(db);
    const res = await app.request('/me/consents', {
      headers: { 'x-test-claims': validClaimsHeader },
    });
    expect(res.status).toBe(404);
  });

  it('lista consents activos por default', async () => {
    const db = makeDbStub({
      selects: [
        [{ id: USER_ID }],
        [
          {
            id: 'c1',
            stakeholderId: 'stk1',
            stakeholderOrgName: 'Walmart Chile S.A.',
            scopeType: 'organizacion',
            scopeId: 'emp1',
            dataCategories: ['emisiones_carbono'],
            grantedAt: new Date('2026-01-01'),
            expiresAt: null,
            revokedAt: null,
          },
        ],
      ],
    });
    const app = await buildApp(db);
    const res = await app.request('/me/consents', {
      headers: { 'x-test-claims': validClaimsHeader },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { consents: unknown[] };
    expect(body.consents).toHaveLength(1);
  });

  it('include_inactive=true incluye revocados', async () => {
    const db = makeDbStub({
      selects: [
        [{ id: USER_ID }],
        [
          {
            id: 'c1',
            stakeholderId: 'stk1',
            stakeholderOrgName: 'Org',
            scopeType: 'organizacion',
            scopeId: 'emp1',
            dataCategories: ['rutas'],
            grantedAt: new Date('2026-01-01'),
            expiresAt: null,
            revokedAt: new Date('2026-04-01'),
          },
        ],
      ],
    });
    const app = await buildApp(db);
    const res = await app.request('/me/consents?include_inactive=true', {
      headers: { 'x-test-claims': validClaimsHeader },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { consents: { revoked_at: string | null }[] };
    expect(body.consents[0]?.revoked_at).not.toBeNull();
  });
});
