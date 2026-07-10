import type { Logger } from '@booster-ai/logger';
import type { Auth } from 'firebase-admin/auth';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserContext } from '../services/user-context.js';

/**
 * Tests de GET /auth/impersonate/targets — el picker del frontend lista los
 * usuarios impersonables (empresas es_demo). Read-only, mismo trust boundary
 * de caller que el mint (requirePlatformAdmin + flag).
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

interface TargetListRow {
  id: string;
  fullName: string;
  empresa: string;
  role: string;
}

/** Fake db para la query con join chain (.select().from().innerJoin×2.where()). */
function makeDb(rows: TargetListRow[]) {
  const where = vi.fn(async () => rows);
  const innerJoin2 = vi.fn(() => ({ where }));
  const innerJoin1 = vi.fn(() => ({ innerJoin: innerJoin2 }));
  const from = vi.fn(() => ({ innerJoin: innerJoin1 }));
  const select = vi.fn(() => ({ from }));
  return { db: { select } as never, spies: { select, where } };
}

function adminContext(email: string | undefined = ADMIN_EMAIL, id = 'admin-uuid'): UserContext {
  return {
    user: { id, email },
    memberships: [],
    activeMembership: null,
    impersonatedBy: null,
  } as unknown as UserContext;
}

function makeApp(opts: { db: never; userContext?: UserContext | null }) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (opts.userContext) {
      c.set('userContext', opts.userContext);
    }
    await next();
  });
  app.route(
    '/auth',
    createAuthImpersonateRoutes({
      db: opts.db,
      firebaseAuth: { createCustomToken: vi.fn() } as unknown as Auth,
      logger: noopLogger,
    }),
  );
  return app;
}

function get(app: Hono) {
  return app.request('/auth/impersonate/targets', { method: 'GET' });
}

beforeEach(() => {
  featureActivated = true;
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('GET /auth/impersonate/targets', () => {
  it('feature flag OFF → 503 feature_disabled', async () => {
    featureActivated = false;
    const { db } = makeDb([]);
    const app = makeApp({ db, userContext: adminContext() });
    const res = await get(app);
    expect(res.status).toBe(503);
  });

  it('caller NO admin → 403 forbidden_platform_admin', async () => {
    const { db } = makeDb([]);
    const app = makeApp({ db, userContext: adminContext('random@user.cl', 'x') });
    const res = await get(app);
    expect(res.status).toBe(403);
  });

  it('admin → 200 con la lista de targets mapeada (id, full_name, empresa, role)', async () => {
    const { db } = makeDb([
      { id: 'u1', fullName: 'Ana Demo', empresa: 'Demo Shipper SpA', role: 'dueno' },
      { id: 'u2', fullName: 'Beto Demo', empresa: 'Demo Carrier SpA', role: 'despachador' },
    ]);
    const app = makeApp({ db, userContext: adminContext() });
    const res = await get(app);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      targets: Array<{ id: string; full_name: string; empresa: string; role: string }>;
    };
    expect(body.targets).toHaveLength(2);
    expect(body.targets[0]).toEqual({
      id: 'u1',
      full_name: 'Ana Demo',
      empresa: 'Demo Shipper SpA',
      role: 'dueno',
    });
  });

  it('admin sin targets → 200 con lista vacía', async () => {
    const { db } = makeDb([]);
    const app = makeApp({ db, userContext: adminContext() });
    const res = await get(app);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { targets: unknown[] };
    expect(body.targets).toEqual([]);
  });
});
