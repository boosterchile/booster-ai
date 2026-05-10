import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMeRoutes } from '../../src/routes/me.js';

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: vi.fn(),
  warn: noop,
  error: noop,
  fatal: noop,
  child: () => noopLogger,
} as never;

interface DbQueues {
  selects?: unknown[][];
  updates?: unknown[][];
}

function makeDb(opts: DbQueues = {}) {
  const selects = [...(opts.selects ?? [])];
  const updates = [...(opts.updates ?? [])];

  const buildSelectChain = () => {
    const chain: Record<string, unknown> = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      limit: vi.fn(async () => selects.shift() ?? []),
    };
    return chain;
  };
  const buildUpdateChain = () => ({
    set: vi.fn(() => ({
      where: vi.fn(async () => updates.shift() ?? []),
    })),
  });

  return {
    select: vi.fn(() => buildSelectChain()),
    update: vi.fn(() => buildUpdateChain()),
  };
}

const USER_ID = '11111111-1111-1111-1111-111111111111';
const EMPRESA_ID = '22222222-2222-2222-2222-222222222222';
const CARRIER_MEM_ID = '33333333-3333-3333-3333-333333333333';

function buildApp(db: ReturnType<typeof makeDb>, claimsUid = 'fb-uid') {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('firebaseClaims', { uid: claimsUid } as never);
    await next();
  });
  app.route('/me', createMeRoutes({ db: db as never, logger: noopLogger }));
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /me/consent/terms-v2', () => {
  it('sin X-Empresa-Id → 400 no_active_empresa', async () => {
    const db = makeDb();
    const app = buildApp(db);
    const res = await app.request('/me/consent/terms-v2', { method: 'POST' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('no_active_empresa');
  });

  it('user no encontrado → 404', async () => {
    const db = makeDb({ selects: [[]] }); // user lookup vacío
    const app = buildApp(db);
    const res = await app.request('/me/consent/terms-v2', {
      method: 'POST',
      headers: { 'X-Empresa-Id': EMPRESA_ID },
    });
    expect(res.status).toBe(404);
  });

  it('sin membership activa en la empresa → 403', async () => {
    const db = makeDb({
      selects: [
        [{ id: USER_ID }], // user OK
        [], // membership vacía
      ],
    });
    const app = buildApp(db);
    const res = await app.request('/me/consent/terms-v2', {
      method: 'POST',
      headers: { 'X-Empresa-Id': EMPRESA_ID },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('forbidden_no_membership');
  });

  it('empresa no es carrier (sin carrier_memberships) → 409 no_carrier_membership', async () => {
    const db = makeDb({
      selects: [
        [{ id: USER_ID }],
        [{ id: 'm1' }],
        [], // carrier_memberships vacío
      ],
    });
    const app = buildApp(db);
    const res = await app.request('/me/consent/terms-v2', {
      method: 'POST',
      headers: { 'X-Empresa-Id': EMPRESA_ID },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('no_carrier_membership');
  });

  it('idempotente: ya aceptado → 200 already_accepted=true sin UPDATE', async () => {
    const prevDate = new Date('2026-05-01T00:00:00Z');
    const db = makeDb({
      selects: [
        [{ id: USER_ID }],
        [{ id: 'm1' }],
        [
          {
            id: CARRIER_MEM_ID,
            consentTermsV2AceptadoEn: prevDate,
          },
        ],
      ],
    });
    const app = buildApp(db);
    const res = await app.request('/me/consent/terms-v2', {
      method: 'POST',
      headers: { 'X-Empresa-Id': EMPRESA_ID },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      accepted_at: string;
      already_accepted: boolean;
    };
    expect(body.ok).toBe(true);
    expect(body.already_accepted).toBe(true);
    expect(body.accepted_at).toBe(prevDate.toISOString());
    expect(db.update).not.toHaveBeenCalled();
  });

  it('happy path: pendiente → UPDATE con IP + UA + timestamp', async () => {
    const db = makeDb({
      selects: [
        [{ id: USER_ID }],
        [{ id: 'm1' }],
        [{ id: CARRIER_MEM_ID, consentTermsV2AceptadoEn: null }],
      ],
      updates: [[{ id: CARRIER_MEM_ID }]],
    });
    const app = buildApp(db);
    const res = await app.request('/me/consent/terms-v2', {
      method: 'POST',
      headers: {
        'X-Empresa-Id': EMPRESA_ID,
        'x-forwarded-for': '1.2.3.4',
        'user-agent': 'TestUA/1.0',
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; already_accepted: boolean };
    expect(body.ok).toBe(true);
    expect(body.already_accepted).toBe(false);
    expect(db.update).toHaveBeenCalled();
  });

  it('x-forwarded-for con múltiples IPs → captura solo la primera', async () => {
    const setSpy = vi.fn(() => ({ where: vi.fn(async () => []) }));
    const db = {
      select: vi.fn(() => {
        const chain: Record<string, unknown> = {
          from: vi.fn(() => chain),
          where: vi.fn(() => chain),
        };
        let i = 0;
        const responses = [
          [{ id: USER_ID }],
          [{ id: 'm1' }],
          [{ id: CARRIER_MEM_ID, consentTermsV2AceptadoEn: null }],
        ];
        chain.limit = vi.fn(async () => responses[i++] ?? []);
        return chain;
      }),
      update: vi.fn(() => ({ set: setSpy })),
    };
    const app = buildApp(db as never);
    await app.request('/me/consent/terms-v2', {
      method: 'POST',
      headers: {
        'X-Empresa-Id': EMPRESA_ID,
        'x-forwarded-for': '1.2.3.4, 5.6.7.8, 9.10.11.12',
      },
    });
    expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({ consentTermsV2Ip: '1.2.3.4' }));
  });
});

describe('GET /me/consent/terms-v2', () => {
  it('sin X-Empresa-Id → accepted:false, reason:no_active_empresa', async () => {
    const db = makeDb();
    const app = buildApp(db);
    const res = await app.request('/me/consent/terms-v2');
    const body = (await res.json()) as { accepted: boolean; reason: string };
    expect(body.accepted).toBe(false);
    expect(body.reason).toBe('no_active_empresa');
  });

  it('empresa no es carrier → accepted:true, reason:not_a_carrier', async () => {
    const db = makeDb({
      selects: [[]], // carrier_memberships vacío
    });
    const app = buildApp(db);
    const res = await app.request('/me/consent/terms-v2', {
      headers: { 'X-Empresa-Id': EMPRESA_ID },
    });
    const body = (await res.json()) as { accepted: boolean; reason: string };
    expect(body.accepted).toBe(true);
    expect(body.reason).toBe('not_a_carrier');
  });

  it('carrier sin consent → accepted:false, reason:pending', async () => {
    const db = makeDb({
      selects: [[{ consentTermsV2AceptadoEn: null }]],
    });
    const app = buildApp(db);
    const res = await app.request('/me/consent/terms-v2', {
      headers: { 'X-Empresa-Id': EMPRESA_ID },
    });
    const body = (await res.json()) as { accepted: boolean; reason: string };
    expect(body.accepted).toBe(false);
    expect(body.reason).toBe('pending');
  });

  it('carrier con consent → accepted:true + accepted_at', async () => {
    const date = new Date('2026-05-10T00:00:00Z');
    const db = makeDb({
      selects: [[{ consentTermsV2AceptadoEn: date }]],
    });
    const app = buildApp(db);
    const res = await app.request('/me/consent/terms-v2', {
      headers: { 'X-Empresa-Id': EMPRESA_ID },
    });
    const body = (await res.json()) as { accepted: boolean; accepted_at: string };
    expect(body.accepted).toBe(true);
    expect(body.accepted_at).toBe(date.toISOString());
  });
});
