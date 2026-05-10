import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUserContextMiddleware } from '../../src/middleware/user-context.js';
import {
  EmpresaNotInMembershipsError,
  UserNotFoundError,
} from '../../src/services/user-context.js';

// Mock resolveUserContext para controlar el comportamiento del middleware sin BD real.
vi.mock('../../src/services/user-context.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/user-context.js')>(
    '../../src/services/user-context.js',
  );
  return {
    ...actual,
    resolveUserContext: vi.fn(),
  };
});

const { resolveUserContext } = await import('../../src/services/user-context.js');

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: noop,
  child: () => noopLogger,
} as unknown as Parameters<typeof createUserContextMiddleware>[0]['logger'];

const FB_UID = 'fb-uid-1';
const claimsHeader = JSON.stringify({ uid: FB_UID, email: 'a@b.c' });

function buildApp() {
  const app = new Hono();
  // Pre-middleware que setea firebaseClaims si viene el header de test
  app.use('/protected/*', async (c, next) => {
    const ch = c.req.header('x-test-claims');
    if (ch) {
      const parsed = JSON.parse(ch) as { uid: string; email?: string };
      c.set('firebaseClaims', {
        uid: parsed.uid,
        email: parsed.email,
        emailVerified: true,
        name: undefined,
        picture: undefined,
        custom: {},
      });
    }
    await next();
  });
  app.use(
    '/protected/*',
    createUserContextMiddleware({
      db: {} as never,
      logger: noopLogger,
    }),
  );
  app.get('/protected/whoami', (c) => {
    const ctx = c.get('userContext');
    return c.json({ ok: true, hasCtx: !!ctx });
  });
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('userContext middleware', () => {
  it('sin firebaseClaims previo → 500 internal_server_error', async () => {
    const app = buildApp();
    const res = await app.request('/protected/whoami'); // sin header x-test-claims
    expect(res.status).toBe(500);
    expect(noopLogger.error).toHaveBeenCalled();
  });

  it('user no registrado en BD → 404 con code=user_not_registered', async () => {
    (resolveUserContext as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new UserNotFoundError(FB_UID),
    );
    const app = buildApp();
    const res = await app.request('/protected/whoami', {
      headers: { 'x-test-claims': claimsHeader },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('user_not_registered');
  });

  it('X-Empresa-Id no matchea membership → 403 empresa_forbidden', async () => {
    (resolveUserContext as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new EmpresaNotInMembershipsError('user-uuid', 'empresa-foreign'),
    );
    const app = buildApp();
    const res = await app.request('/protected/whoami', {
      headers: { 'x-test-claims': claimsHeader, 'x-empresa-id': 'empresa-foreign' },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('empresa_forbidden');
  });

  it('happy path: setea userContext + pasa a next', async () => {
    (resolveUserContext as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: { id: 'user-uuid' },
      memberships: [],
      activeMembership: { membership: { id: 'm1' }, empresa: { id: 'emp-1' } },
    });
    const app = buildApp();
    const res = await app.request('/protected/whoami', {
      headers: { 'x-test-claims': claimsHeader },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; hasCtx: boolean };
    expect(body.ok).toBe(true);
    expect(body.hasCtx).toBe(true);
  });

  it('error inesperado en resolveUserContext → re-throw (5xx default Hono)', async () => {
    (resolveUserContext as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('DB connection lost'),
    );
    const app = buildApp();
    // Hono atrapa errores no manejados y devuelve 500 por default
    const res = await app.request('/protected/whoami', {
      headers: { 'x-test-claims': claimsHeader },
    });
    expect(res.status).toBe(500);
  });

  it('pasa requestedEmpresaId desde header X-Empresa-Id al service', async () => {
    (resolveUserContext as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: { id: 'u' },
      memberships: [],
      activeMembership: null,
    });
    const app = buildApp();
    await app.request('/protected/whoami', {
      headers: { 'x-test-claims': claimsHeader, 'x-empresa-id': 'emp-specific' },
    });
    expect(resolveUserContext).toHaveBeenCalledWith(
      expect.objectContaining({ requestedEmpresaId: 'emp-specific' }),
    );
  });
});
