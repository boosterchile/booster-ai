import type { Logger } from '@booster-ai/logger';
import type { Auth } from 'firebase-admin/auth';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserContext } from '../services/user-context.js';

/**
 * Tests del endpoint POST /auth/impersonate (impersonación auditada) — el
 * TRUST BOUNDARY. Cubre:
 *   - feature flag OFF → 503 feature_disabled.
 *   - caller NO en allowlist platform-admin → 403 forbidden_platform_admin.
 *   - caller admin + target platform-admin → 403 forbidden_impersonate_admin
 *     (sin admin→admin).
 *   - caller admin + target inexistente → 404 target_not_found.
 *   - caller admin + target == caller → 400 cannot_impersonate_self.
 *   - caller admin + target válido → 200 con custom_token; el token se mintea
 *     sobre el UID del target con claim `impersonated_by = admin`; y se
 *     inserta la fila de auditoría en eventos_impersonacion.
 *   - createCustomToken falla → 502 firebase_error, sin fila de auditoría.
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

const ADMIN_EMAIL = 'dev@boosterchile.com';
const ADMIN_ID = '99999999-9999-9999-9999-999999999999';

let featureActivated = true;
vi.mock('../config.js', () => ({
  config: {
    get BOOSTER_PLATFORM_ADMIN_EMAILS() {
      return ['dev@boosterchile.com'];
    },
    get IMPERSONATION_V1_ACTIVATED() {
      return featureActivated;
    },
  },
}));

const { createAuthImpersonateRoutes } = await import('./auth-impersonate.js');

interface TargetRow {
  id: string;
  firebaseUid: string;
  isPlatformAdmin: boolean;
}

function makeDb(targetRow: TargetRow | null) {
  const insertValues = vi.fn(async () => undefined);
  const insert = vi.fn(() => ({ values: insertValues }));
  const limit = vi.fn(async () => (targetRow ? [targetRow] : []));
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return {
    db: { select, insert } as never,
    spies: { insert, insertValues, select },
  };
}

function makeAuth() {
  const createCustomToken = vi.fn(async () => 'minted-custom-token');
  return { auth: { createCustomToken } as unknown as Auth, spies: { createCustomToken } };
}

/** userContext del CALLER (el admin autenticado que invoca el endpoint). */
function adminContext(email: string | undefined = ADMIN_EMAIL, id = ADMIN_ID): UserContext {
  return {
    user: { id, email },
    memberships: [],
    activeMembership: null,
    impersonatedBy: null,
  } as unknown as UserContext;
}

function makeApp(opts: {
  db: never;
  auth: Auth;
  userContext?: UserContext | null;
}) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (opts.userContext) {
      c.set('userContext', opts.userContext);
    }
    await next();
  });
  app.route(
    '/auth',
    createAuthImpersonateRoutes({ db: opts.db, firebaseAuth: opts.auth, logger: noopLogger }),
  );
  return app;
}

function post(app: Hono, body: unknown) {
  return app.request('/auth/impersonate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const VALID_TARGET = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  featureActivated = true;
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /auth/impersonate — trust boundary', () => {
  it('feature flag OFF → 503 feature_disabled', async () => {
    featureActivated = false;
    const { db } = makeDb(null);
    const { auth } = makeAuth();
    const app = makeApp({ db, auth, userContext: adminContext() });
    const res = await post(app, { target_user_id: VALID_TARGET });
    expect(res.status).toBe(503);
  });

  it('caller NO en allowlist → 403 forbidden_platform_admin', async () => {
    const { db } = makeDb(null);
    const { auth } = makeAuth();
    const app = makeApp({
      db,
      auth,
      userContext: adminContext('random@user.cl', 'someone'),
    });
    const res = await post(app, { target_user_id: VALID_TARGET });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('forbidden_platform_admin');
  });

  it('sin userContext (auth Firebase ausente) → 401', async () => {
    const { db } = makeDb(null);
    const { auth } = makeAuth();
    const app = makeApp({ db, auth, userContext: null });
    const res = await post(app, { target_user_id: VALID_TARGET });
    expect(res.status).toBe(401);
  });

  it('caller admin + target es platform-admin → 403 forbidden_impersonate_admin', async () => {
    const { db } = makeDb({ id: 'other', firebaseUid: 'fb', isPlatformAdmin: true });
    const { auth, spies } = makeAuth();
    const app = makeApp({ db, auth, userContext: adminContext() });
    const res = await post(app, { target_user_id: VALID_TARGET });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('forbidden_impersonate_admin');
    expect(spies.createCustomToken).not.toHaveBeenCalled();
  });

  it('caller admin + target inexistente → 404 target_not_found', async () => {
    const { db } = makeDb(null);
    const { auth } = makeAuth();
    const app = makeApp({ db, auth, userContext: adminContext() });
    const res = await post(app, { target_user_id: VALID_TARGET });
    expect(res.status).toBe(404);
  });

  it('caller admin + target == caller → 400 cannot_impersonate_self', async () => {
    const { db } = makeDb({ id: ADMIN_ID, firebaseUid: 'fb', isPlatformAdmin: false });
    const { auth } = makeAuth();
    const app = makeApp({ db, auth, userContext: adminContext() });
    const res = await post(app, { target_user_id: ADMIN_ID });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('cannot_impersonate_self');
  });
});

describe('POST /auth/impersonate — emisión + auditoría', () => {
  it('target válido → 200, token sobre UID del target con claim impersonated_by, + fila de auditoría', async () => {
    const { db, spies } = makeDb({
      id: 'target-uuid',
      firebaseUid: 'target-firebase-uid',
      isPlatformAdmin: false,
    });
    const { auth, spies: authSpies } = makeAuth();
    const app = makeApp({ db, auth, userContext: adminContext() });
    const res = await post(app, { target_user_id: VALID_TARGET });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { custom_token: string; target_user_id: string };
    expect(body.custom_token).toBe('minted-custom-token');
    expect(body.target_user_id).toBe('target-uuid');

    // Token minteado sobre el UID del TARGET con claim impersonated_by = admin.
    expect(authSpies.createCustomToken).toHaveBeenCalledWith(
      'target-firebase-uid',
      expect.objectContaining({ impersonated_by: ADMIN_ID }),
    );

    // Fila de auditoría con admin + target.
    expect(spies.insert).toHaveBeenCalledTimes(1);
    expect(spies.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ adminUserId: ADMIN_ID, targetUserId: 'target-uuid' }),
    );
  });

  it('createCustomToken falla → 502 firebase_error, sin fila de auditoría', async () => {
    const { db, spies } = makeDb({
      id: 'target-uuid',
      firebaseUid: 'target-firebase-uid',
      isPlatformAdmin: false,
    });
    const auth = {
      createCustomToken: vi.fn(async () => {
        throw new Error('firebase down');
      }),
    } as unknown as Auth;
    const app = makeApp({ db, auth, userContext: adminContext() });
    const res = await post(app, { target_user_id: VALID_TARGET });
    expect(res.status).toBe(502);
    expect(spies.insert).not.toHaveBeenCalled();
  });
});
