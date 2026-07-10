import type { Logger } from '@booster-ai/logger';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FirebaseClaims } from './firebase-auth.js';

/**
 * Tests del userContextMiddleware, foco: propagación del claim
 * `impersonated_by` (impersonación auditada) al userContext resuelto.
 *
 * El middleware resuelve el contexto por `claims.uid` (el UID del TARGET
 * cuando la sesión es impersonada) y valida X-Empresa-Id contra las
 * membresías del target — sin huecos. Adicionalmente cuelga
 * `impersonatedBy` (el admin) leído del custom claim, para que el guard de
 * escritura, la auditoría y el banner lo vean.
 */

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

const baseCtx = {
  user: { id: 'target-uuid' },
  memberships: [],
  activeMembership: null,
  impersonatedBy: null,
};

const resolveUserContextMock = vi.fn();
vi.mock('../services/user-context.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/user-context.js')>();
  return {
    ...actual,
    resolveUserContext: (opts: unknown) => resolveUserContextMock(opts),
  };
});

const { createUserContextMiddleware } = await import('./user-context.js');

function makeApp(claims: FirebaseClaims) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('firebaseClaims', claims);
    await next();
  });
  app.use('*', createUserContextMiddleware({ db: {} as never, logger: noopLogger }));
  app.get('/probe', (c) => {
    const ctx = c.get('userContext') as { impersonatedBy: string | null };
    return c.json({ impersonatedBy: ctx.impersonatedBy });
  });
  return app;
}

const IMPERSONATED_CLAIMS: FirebaseClaims = {
  uid: 'target-firebase-uid',
  email: undefined,
  emailVerified: false,
  name: undefined,
  picture: undefined,
  custom: { impersonated_by: 'admin-uuid' },
};

const NORMAL_CLAIMS: FirebaseClaims = {
  uid: 'real-user-uid',
  email: 'real@user.cl',
  emailVerified: true,
  name: 'Real',
  picture: undefined,
  custom: {},
};

beforeEach(() => {
  resolveUserContextMock.mockReset();
  resolveUserContextMock.mockResolvedValue({ ...baseCtx });
});

describe('userContextMiddleware — propagación de impersonated_by', () => {
  it('sesión impersonada → userContext.impersonatedBy = admin del claim', async () => {
    const app = makeApp(IMPERSONATED_CLAIMS);
    const res = await app.request('/probe');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { impersonatedBy: string | null };
    expect(body.impersonatedBy).toBe('admin-uuid');
  });

  it('resuelve el contexto por el uid del TARGET (claims.uid)', async () => {
    const app = makeApp(IMPERSONATED_CLAIMS);
    await app.request('/probe');
    expect(resolveUserContextMock).toHaveBeenCalledWith(
      expect.objectContaining({ firebaseUid: 'target-firebase-uid' }),
    );
  });

  it('sesión normal (sin claim) → impersonatedBy = null', async () => {
    const app = makeApp(NORMAL_CLAIMS);
    const res = await app.request('/probe');
    const body = (await res.json()) as { impersonatedBy: string | null };
    expect(body.impersonatedBy).toBeNull();
  });
});
