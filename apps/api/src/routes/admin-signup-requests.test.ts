import type { Logger } from '@booster-ai/logger';
import type { Auth } from 'firebase-admin/auth';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAdminSignupRequestsRoutes } from './admin-signup-requests.js';

// T10 SEC-001 Sprint 2b — unit tests admin-signup-requests routes (SC-1.2.1
// completion). Cubre 3 endpoints (GET list, POST approve, POST reject) +
// gate de feature flag + role check + outcomes del service mockeado.

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

const ADMIN_EMAIL = 'dev@boosterchile.com';

vi.mock('../config.js', () => ({
  config: {
    BOOSTER_PLATFORM_ADMIN_EMAILS: ['dev@boosterchile.com'],
    SIGNUP_REQUEST_FLOW_ACTIVATED: true,
  },
}));

function makeAuthStub() {
  const createUser = vi.fn(async () => ({ uid: 'fb-new-uid' }));
  return { auth: { createUser } as unknown as Auth, spies: { createUser } };
}

function makeNotifierStub() {
  return {
    notifyAdminsOfNewRequest: vi.fn(async () => undefined),
    notifyUserOfApproval: vi.fn(async () => undefined),
    notifyUserOfRejection: vi.fn(async () => undefined),
  };
}

interface MakeDbOpts {
  selectRows?: Array<{
    id: string;
    email: string;
    nombreCompleto: string;
    estado: 'pendiente_aprobacion' | 'aprobado' | 'rechazado';
    solicitadoEn: Date;
    aprobadoPor: string | null;
    aprobadoEn: Date | null;
  }>;
  updateRows?: Array<{ id: string; email: string }>;
}

function makeDb(opts: MakeDbOpts = {}) {
  const selectLimit = vi.fn(async () => opts.selectRows ?? []);
  const selectOrderBy = vi.fn(() => ({ limit: selectLimit }));
  const selectWhere = vi.fn(() => ({
    orderBy: selectOrderBy,
    limit: selectLimit,
  }));
  const selectFrom = vi.fn(() => ({ where: selectWhere }));
  const select = vi.fn(() => ({ from: selectFrom }));

  const updateReturning = vi.fn(async () => opts.updateRows ?? []);
  const updateWhere = vi.fn(() => ({ returning: updateReturning }));
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));

  interface TxStub {
    insert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  }
  const tx: TxStub = {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => [{ id: 'user-new-uuid' }]),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => [{ id: 'sig-uuid' }]),
        })),
      })),
    })),
  };
  const transaction = vi.fn(async (cb: (tx: TxStub) => Promise<{ userId: string }>) => cb(tx));

  type DbStub = Parameters<typeof createAdminSignupRequestsRoutes>[0]['db'];
  return {
    db: { select, update, transaction } as unknown as DbStub,
    spies: { select, update, transaction, tx },
  };
}

function userContextHeader(email = ADMIN_EMAIL) {
  return {
    'content-type': 'application/json',
    'x-test-user-email': email,
  };
}

function makeAppWithContext(
  db: ReturnType<typeof makeDb>['db'],
  auth: Auth,
  notifier: ReturnType<typeof makeNotifierStub>,
  email: string | null = ADMIN_EMAIL,
) {
  const routes = createAdminSignupRequestsRoutes({ db, logger: noopLogger, auth, notifier });
  // Inject userContext via wrapper (paridad admin-stakeholder-orgs middleware).
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (email) {
      (c as unknown as { set: (key: string, value: unknown) => void }).set('userContext', {
        user: { id: 'admin-user-id', email },
      });
    }
    await next();
  });
  app.route('/', routes);
  return app;
}

describe('POST /admin/signup-requests endpoints (SC-1.2.1)', () => {
  it('GET / → 200 con lista filtrada (admin platform)', async () => {
    const d = makeDb({
      selectRows: [
        {
          id: 'req-1',
          email: 'a@x.cl',
          nombreCompleto: 'Cliente A',
          estado: 'pendiente_aprobacion',
          solicitadoEn: new Date('2026-05-26T10:00:00Z'),
          aprobadoPor: null,
          aprobadoEn: null,
        },
      ],
    });
    const a = makeAuthStub();
    const n = makeNotifierStub();
    const app = makeAppWithContext(d.db, a.auth, n);

    const res = await app.request('/', { method: 'GET', headers: userContextHeader() });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { signup_requests: Array<{ id: string }> };
    expect(json.signup_requests).toHaveLength(1);
    expect(json.signup_requests[0]?.id).toBe('req-1');
  });

  it('GET / sin userContext → 401', async () => {
    const d = makeDb();
    const a = makeAuthStub();
    const n = makeNotifierStub();
    const app = makeAppWithContext(d.db, a.auth, n, null);

    const res = await app.request('/', { method: 'GET', headers: userContextHeader() });
    expect(res.status).toBe(401);
  });

  it('GET / con email no en allowlist → 403 forbidden_platform_admin', async () => {
    const d = makeDb();
    const a = makeAuthStub();
    const n = makeNotifierStub();
    const app = makeAppWithContext(d.db, a.auth, n, 'otro@no-admin.cl');

    const res = await app.request('/', { method: 'GET', headers: userContextHeader() });
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('forbidden_platform_admin');
  });

  it('POST /:id/approve happy → 200 + Admin SDK createUser invoked + notify user', async () => {
    const d = makeDb({
      selectRows: [
        {
          id: '11111111-1111-1111-1111-111111111111',
          email: 'nuevo@cliente.cl',
          nombreCompleto: 'Nuevo Cliente',
          estado: 'pendiente_aprobacion',
          solicitadoEn: new Date(),
          aprobadoPor: null,
          aprobadoEn: null,
        },
      ],
    });
    const a = makeAuthStub();
    const n = makeNotifierStub();
    const app = makeAppWithContext(d.db, a.auth, n);

    const res = await app.request('/11111111-1111-1111-1111-111111111111/approve', {
      method: 'POST',
      headers: userContextHeader(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; outcome: string; firebase_uid: string };
    expect(json.ok).toBe(true);
    expect(json.outcome).toBe('approved');
    expect(json.firebase_uid).toBe('fb-new-uid');
    expect(a.spies.createUser).toHaveBeenCalledWith({
      email: 'nuevo@cliente.cl',
      displayName: 'Nuevo Cliente',
      emailVerified: false,
    });
    expect(n.notifyUserOfApproval).toHaveBeenCalled();
    // W1.4 — flag ADMIN_PROVISIONED_ONBOARDING_ENABLED OFF (ausente del mock
    // de config en este describe): la respuesta NO trae los campos nuevos.
    expect(json).not.toHaveProperty('onboarding_link');
    expect(json).not.toHaveProperty('onboarding_link_expires_at');
  });

  it('POST /:id/approve con onboardingLinkBaseUrl no-https → 400 (zValidator)', async () => {
    const d = makeDb({
      selectRows: [
        {
          id: '11111111-1111-1111-1111-111111111111',
          email: 'nuevo@cliente.cl',
          nombreCompleto: 'Nuevo Cliente',
          estado: 'pendiente_aprobacion',
          solicitadoEn: new Date(),
          aprobadoPor: null,
          aprobadoEn: null,
        },
      ],
    });
    const a = makeAuthStub();
    const n = makeNotifierStub();
    const app = makeAppWithContext(d.db, a.auth, n);

    const res = await app.request('/11111111-1111-1111-1111-111111111111/approve', {
      method: 'POST',
      headers: userContextHeader(),
      body: JSON.stringify({ onboardingLinkBaseUrl: 'http://no-https.example.com/x' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /:id/approve cuando service retorna not_found → 404', async () => {
    const d = makeDb({ selectRows: [] }); // not found
    const a = makeAuthStub();
    const n = makeNotifierStub();
    const app = makeAppWithContext(d.db, a.auth, n);

    const res = await app.request('/11111111-1111-1111-1111-111111111111/approve', {
      method: 'POST',
      headers: userContextHeader(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('signup_request_not_found');
  });

  it('POST /:id/approve cuando estado != pendiente → 409 already_processed', async () => {
    const d = makeDb({
      selectRows: [
        {
          id: '11111111-1111-1111-1111-111111111111',
          email: 'ya@procesado.cl',
          nombreCompleto: 'X',
          estado: 'aprobado',
          solicitadoEn: new Date(),
          aprobadoPor: 'otro@admin.cl',
          aprobadoEn: new Date(),
        },
      ],
    });
    const a = makeAuthStub();
    const n = makeNotifierStub();
    const app = makeAppWithContext(d.db, a.auth, n);

    const res = await app.request('/11111111-1111-1111-1111-111111111111/approve', {
      method: 'POST',
      headers: userContextHeader(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(409);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('signup_request_already_processed');
  });

  it('POST /:id/approve cuando Firebase createUser arroja email-already-exists → 409', async () => {
    const d = makeDb({
      selectRows: [
        {
          id: '11111111-1111-1111-1111-111111111111',
          email: 'duplicado@cliente.cl',
          nombreCompleto: 'Dup',
          estado: 'pendiente_aprobacion',
          solicitadoEn: new Date(),
          aprobadoPor: null,
          aprobadoEn: null,
        },
      ],
    });
    const a = makeAuthStub();
    a.spies.createUser.mockRejectedValueOnce(
      Object.assign(new Error('exists'), { code: 'auth/email-already-exists' }),
    );
    const n = makeNotifierStub();
    const app = makeAppWithContext(d.db, a.auth, n);

    const res = await app.request('/11111111-1111-1111-1111-111111111111/approve', {
      method: 'POST',
      headers: userContextHeader(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(409);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('firebase_user_already_exists');
  });

  it('POST /:id/reject happy → 200 + notify rejection', async () => {
    const d = makeDb({ updateRows: [{ id: 'req-r', email: 'rechaz@cli.cl' }] });
    const a = makeAuthStub();
    const n = makeNotifierStub();
    const app = makeAppWithContext(d.db, a.auth, n);

    const res = await app.request('/22222222-2222-2222-2222-222222222222/reject', {
      method: 'POST',
      headers: userContextHeader(),
      body: JSON.stringify({ reason: 'datos incompletos' }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; outcome: string };
    expect(json.ok).toBe(true);
    expect(json.outcome).toBe('rejected');
    expect(n.notifyUserOfRejection).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'datos incompletos' }),
    );
  });

  it('POST /:id/approve uuid inválido → 400 (zValidator)', async () => {
    const d = makeDb();
    const a = makeAuthStub();
    const n = makeNotifierStub();
    const app = makeAppWithContext(d.db, a.auth, n);

    const res = await app.request('/not-a-uuid/approve', {
      method: 'POST',
      headers: userContextHeader(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('POST /:id/reject reason > 500 chars → 400 (zValidator)', async () => {
    const d = makeDb();
    const a = makeAuthStub();
    const n = makeNotifierStub();
    const app = makeAppWithContext(d.db, a.auth, n);

    const res = await app.request('/22222222-2222-2222-2222-222222222222/reject', {
      method: 'POST',
      headers: userContextHeader(),
      body: JSON.stringify({ reason: 'x'.repeat(501) }),
    });
    expect(res.status).toBe(400);
  });
});

describe('admin-signup-requests con feature flag OFF', () => {
  it('GET / → 503 signup_flow_disabled cuando flag OFF', async () => {
    vi.resetModules();
    vi.doMock('../config.js', () => ({
      config: {
        BOOSTER_PLATFORM_ADMIN_EMAILS: ['dev@boosterchile.com'],
        SIGNUP_REQUEST_FLOW_ACTIVATED: false,
      },
    }));
    const mod = await import('./admin-signup-requests.js');

    const d = makeDb();
    const a = makeAuthStub();
    const n = makeNotifierStub();
    const routes = mod.createAdminSignupRequestsRoutes({
      db: d.db,
      logger: noopLogger,
      auth: a.auth,
      notifier: n,
    });

    const app = new Hono();
    app.use('*', async (c, next) => {
      (c as unknown as { set: (key: string, value: unknown) => void }).set('userContext', {
        user: { id: 'admin-id', email: ADMIN_EMAIL },
      });
      await next();
    });
    app.route('/', routes);

    const res = await app.request('/', { method: 'GET', headers: userContextHeader() });
    expect(res.status).toBe(503);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('signup_flow_disabled');

    vi.doUnmock('../config.js');
    vi.resetModules();
  });
});

describe('POST /:id/approve con ADMIN_PROVISIONED_ONBOARDING_ENABLED=true (W1.4 onboarding_link)', () => {
  const REQUEST_ID = '11111111-1111-1111-1111-111111111111';
  const SIGNING_SECRET = 'a'.repeat(32); // >=32 bytes — assertStrongSecret fail-closed.
  const TTL_HOURS = 6;

  function selectRow() {
    return {
      id: REQUEST_ID,
      email: 'nuevo@cliente.cl',
      nombreCompleto: 'Nuevo Cliente',
      estado: 'pendiente_aprobacion' as const,
      solicitadoEn: new Date(),
      aprobadoPor: null,
      aprobadoEn: null,
    };
  }

  async function loadModWithAdminProvisionedConfig() {
    vi.resetModules();
    vi.doMock('../config.js', () => ({
      config: {
        BOOSTER_PLATFORM_ADMIN_EMAILS: ['dev@boosterchile.com'],
        SIGNUP_REQUEST_FLOW_ACTIVATED: true,
        ADMIN_PROVISIONED_ONBOARDING_ENABLED: true,
        ONBOARDING_TOKEN_SIGNING_SECRET: SIGNING_SECRET,
        ONBOARDING_TOKEN_TTL_HOURS: TTL_HOURS,
      },
    }));
    return import('./admin-signup-requests.js');
  }

  function buildApp(
    mod: Awaited<ReturnType<typeof loadModWithAdminProvisionedConfig>>,
    db: ReturnType<typeof makeDb>['db'],
    auth: Auth,
    notifier: ReturnType<typeof makeNotifierStub>,
    logger: Logger = noopLogger,
  ) {
    const routes = mod.createAdminSignupRequestsRoutes({ db, logger, auth, notifier });
    const app = new Hono();
    app.use('*', async (c, next) => {
      (c as unknown as { set: (key: string, value: unknown) => void }).set('userContext', {
        user: { id: 'admin-id', email: ADMIN_EMAIL },
      });
      await next();
    });
    app.route('/', routes);
    return app;
  }

  afterEach(() => {
    vi.doUnmock('../config.js');
    vi.resetModules();
  });

  it('con secreto + flag ON → 200 con onboarding_link (base default) + expires_at coherente con TTL', async () => {
    const mod = await loadModWithAdminProvisionedConfig();
    const d = makeDb({
      selectRows: [selectRow()],
      updateRows: [{ id: REQUEST_ID, email: 'nuevo@cliente.cl' }],
    });
    const a = makeAuthStub();
    const n = makeNotifierStub();
    const app = buildApp(mod, d.db, a.auth, n);

    const before = Date.now();
    const res = await app.request(`/${REQUEST_ID}/approve`, {
      method: 'POST',
      headers: userContextHeader(),
      body: JSON.stringify({}),
    });
    const after = Date.now();

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      outcome: string;
      onboarding_link: string;
      onboarding_link_expires_at: string;
    };
    expect(json.ok).toBe(true);
    expect(json.outcome).toBe('approved');
    expect(json.onboarding_link).toMatch(
      /^https:\/\/app\.boosterchile\.com\/onboarding-admin\?token=.+$/,
    );
    const expiresAtMs = new Date(json.onboarding_link_expires_at).getTime();
    const ttlMs = TTL_HOURS * 60 * 60 * 1000;
    expect(expiresAtMs).toBeGreaterThanOrEqual(before + ttlMs);
    expect(expiresAtMs).toBeLessThanOrEqual(after + ttlMs);
  });

  it('con onboardingLinkBaseUrl custom → onboarding_link usa esa base', async () => {
    const mod = await loadModWithAdminProvisionedConfig();
    const d = makeDb({
      selectRows: [selectRow()],
      updateRows: [{ id: REQUEST_ID, email: 'nuevo@cliente.cl' }],
    });
    const a = makeAuthStub();
    const n = makeNotifierStub();
    const app = buildApp(mod, d.db, a.auth, n);

    const res = await app.request(`/${REQUEST_ID}/approve`, {
      method: 'POST',
      headers: userContextHeader(),
      body: JSON.stringify({ onboardingLinkBaseUrl: 'https://custom.example.com/consume' }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { onboarding_link: string };
    expect(json.onboarding_link).toMatch(/^https:\/\/custom\.example\.com\/consume\?token=.+$/);
  });

  it('el token emitido NUNCA aparece en los logs capturados (solo redacted boolean upstream)', async () => {
    const mod = await loadModWithAdminProvisionedConfig();
    const d = makeDb({
      selectRows: [selectRow()],
      updateRows: [{ id: REQUEST_ID, email: 'nuevo@cliente.cl' }],
    });
    const a = makeAuthStub();
    const n = makeNotifierStub();

    const logCalls: unknown[] = [];
    const record = (...args: unknown[]) => {
      logCalls.push(args);
    };
    const spyLogger = {
      trace: record,
      debug: record,
      info: record,
      warn: record,
      error: record,
      fatal: record,
      child: () => spyLogger,
    } as unknown as Logger;

    const app = buildApp(mod, d.db, a.auth, n, spyLogger);

    const res = await app.request(`/${REQUEST_ID}/approve`, {
      method: 'POST',
      headers: userContextHeader(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { onboarding_link: string };
    const rawToken = new URL(json.onboarding_link).searchParams.get('token');
    expect(rawToken).toBeTruthy();

    const serializedLogs = JSON.stringify(logCalls);
    expect(serializedLogs.includes(rawToken as string)).toBe(false);
  });
});
