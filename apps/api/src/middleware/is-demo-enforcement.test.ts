import type { Logger } from '@booster-ai/logger';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { FirebaseClaims } from './firebase-auth.js';
import {
  type IsDemoAllowlistEntry,
  createIsDemoEnforcementMiddleware,
} from './is-demo-enforcement.js';

/**
 * Tests del middleware is-demo-enforcement (T1 SEC-001 Sprint 2b).
 *
 * Cubre per spec sec-001-cierre §10 T1 + plan-sprint-2b §3 T1:
 *   - 3 modos (requireNotDemo / requireNotDemoOrSandbox / explicitAllow).
 *   - Claim ausente → passthrough (middleware no es auth, es authorization).
 *   - is_demo:true + requireNotDemo (POST) → 403 forbidden_demo.
 *   - is_demo:true + requireNotDemo (GET idempotent-safe) → passthrough.
 *   - is_demo:true + requireNotDemoOrSandbox + persona=stakeholder → passthrough (read-only por contrato).
 *   - is_demo:true + requireNotDemoOrSandbox + persona!=stakeholder → 403.
 *   - is_demo:true + explicitAllow + path+method matches allowlist → passthrough.
 *   - is_demo:true + explicitAllow + path no-match → 403.
 *   - is_demo:true + explicitAllow + path matches pero method no → 403.
 *   - is_demo:false → passthrough (cuentas reales por contrato fuera de scope).
 *   - Response shape 403: {error:'forbidden_demo', code:'forbidden_demo'}.
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

const NON_DEMO_CLAIMS: FirebaseClaims = {
  uid: 'real-user-1',
  email: 'real@user.cl',
  emailVerified: true,
  name: 'Real',
  picture: undefined,
  custom: {},
};
const DEMO_CLAIMS_SHIPPER: FirebaseClaims = {
  uid: 'demo-uid-1',
  email: 'demo-2026-shipper@boosterchile.com',
  emailVerified: false,
  name: 'Demo Shipper',
  picture: undefined,
  custom: { is_demo: true, persona: 'generador_carga' },
};
const DEMO_CLAIMS_STAKEHOLDER: FirebaseClaims = {
  uid: 'demo-uid-2',
  email: 'demo-2026-stakeholder@boosterchile.com',
  emailVerified: false,
  name: 'Demo Stakeholder',
  picture: undefined,
  custom: { is_demo: true, persona: 'stakeholder' },
};
const DEMO_CLAIMS_IS_DEMO_FALSE: FirebaseClaims = {
  uid: 'flagged-real-user',
  email: 'flagged@user.cl',
  emailVerified: true,
  name: 'Flagged Real',
  picture: undefined,
  custom: { is_demo: false, persona: 'generador_carga' },
};

/**
 * Helper: arma una app Hono que setea firebaseClaims (o no si null), aplica
 * el middleware bajo test, y agrega 3 handlers (GET/POST/PUT) en distintos
 * paths para que los tests puedan ejercer cada combinación.
 */
function makeAppWithClaims(
  claims: FirebaseClaims | null,
  middleware: ReturnType<typeof createIsDemoEnforcementMiddleware>,
) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (claims) {
      c.set('firebaseClaims', claims);
    }
    await next();
  });
  app.use('*', middleware);
  app.get('/me', (c) => c.json({ ok: true, method: 'GET' }));
  app.get('/feature-flags', (c) => c.json({ ok: true, method: 'GET' }));
  app.post('/me/profile', (c) => c.json({ ok: true, method: 'POST' }));
  app.post('/demo/login', (c) => c.json({ ok: true, method: 'POST' }));
  app.put('/me/profile', (c) => c.json({ ok: true, method: 'PUT' }));
  app.patch('/me/profile', (c) => c.json({ ok: true, method: 'PATCH' }));
  app.delete('/me/profile', (c) => c.json({ ok: true, method: 'DELETE' }));
  return app;
}

describe('is-demo-enforcement middleware', () => {
  describe('claim ausente (request anonymous o sin firebase-auth previo)', () => {
    it('passthrough en cualquier mode', async () => {
      for (const mode of ['requireNotDemo', 'requireNotDemoOrSandbox', 'explicitAllow'] as const) {
        const mw = createIsDemoEnforcementMiddleware({
          mode,
          allowlist: [],
          logger: noopLogger,
        });
        const app = makeAppWithClaims(null, mw);
        const res = await app.request('/me/profile', { method: 'POST' });
        expect(res.status, `mode=${mode}`).toBe(200);
      }
    });
  });

  describe('is_demo claim falsy (cuenta real o flagged is_demo:false)', () => {
    it('passthrough en cualquier mode con claim is_demo ausente', async () => {
      const mw = createIsDemoEnforcementMiddleware({
        mode: 'requireNotDemo',
        allowlist: [],
        logger: noopLogger,
      });
      const app = makeAppWithClaims(NON_DEMO_CLAIMS, mw);
      const res = await app.request('/me/profile', { method: 'POST' });
      expect(res.status).toBe(200);
    });

    it('passthrough con claim is_demo:false explícito', async () => {
      const mw = createIsDemoEnforcementMiddleware({
        mode: 'requireNotDemo',
        allowlist: [],
        logger: noopLogger,
      });
      const app = makeAppWithClaims(DEMO_CLAIMS_IS_DEMO_FALSE, mw);
      const res = await app.request('/me/profile', { method: 'POST' });
      expect(res.status).toBe(200);
    });
  });

  describe('mode=requireNotDemo + is_demo:true', () => {
    it('POST/PUT/PATCH/DELETE → 403 forbidden_demo', async () => {
      const mw = createIsDemoEnforcementMiddleware({
        mode: 'requireNotDemo',
        allowlist: [],
        logger: noopLogger,
      });
      const app = makeAppWithClaims(DEMO_CLAIMS_SHIPPER, mw);
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        const res = await app.request('/me/profile', { method });
        expect(res.status, method).toBe(403);
        const body = (await res.json()) as { error: string; code: string };
        expect(body.error, method).toBe('forbidden_demo');
        expect(body.code, method).toBe('forbidden_demo');
      }
    });

    it('GET idempotent-safe → passthrough', async () => {
      const mw = createIsDemoEnforcementMiddleware({
        mode: 'requireNotDemo',
        allowlist: [],
        logger: noopLogger,
      });
      const app = makeAppWithClaims(DEMO_CLAIMS_SHIPPER, mw);
      const res = await app.request('/me', { method: 'GET' });
      expect(res.status).toBe(200);
    });
  });

  describe('mode=requireNotDemoOrSandbox + is_demo:true', () => {
    it('persona=stakeholder → passthrough (read-only sandbox per contrato)', async () => {
      const mw = createIsDemoEnforcementMiddleware({
        mode: 'requireNotDemoOrSandbox',
        allowlist: [],
        logger: noopLogger,
      });
      const app = makeAppWithClaims(DEMO_CLAIMS_STAKEHOLDER, mw);
      const res = await app.request('/me/profile', { method: 'POST' });
      expect(res.status).toBe(200);
    });

    it('persona=generador_carga → 403 forbidden_demo', async () => {
      const mw = createIsDemoEnforcementMiddleware({
        mode: 'requireNotDemoOrSandbox',
        allowlist: [],
        logger: noopLogger,
      });
      const app = makeAppWithClaims(DEMO_CLAIMS_SHIPPER, mw);
      const res = await app.request('/me/profile', { method: 'POST' });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: string; code: string };
      expect(body.error).toBe('forbidden_demo');
      expect(body.code).toBe('forbidden_demo');
    });
  });

  describe('mode=explicitAllow + is_demo:true', () => {
    const allowlist: IsDemoAllowlistEntry[] = [
      {
        path: '/demo/login',
        methods: ['POST'],
        rationale: 'demo login endpoint requires demo claim by design',
        reviewBy: '2026-08-25',
      },
      {
        path: '/feature-flags',
        methods: ['GET'],
        rationale: 'feature flags fetch is read-only and required by all sessions',
        reviewBy: '2026-08-25',
      },
    ];

    it('path matches + method matches → passthrough', async () => {
      const mw = createIsDemoEnforcementMiddleware({
        mode: 'explicitAllow',
        allowlist,
        logger: noopLogger,
      });
      const app = makeAppWithClaims(DEMO_CLAIMS_SHIPPER, mw);
      const res = await app.request('/demo/login', { method: 'POST' });
      expect(res.status).toBe(200);
    });

    it('path no-match → 403 forbidden_demo', async () => {
      const mw = createIsDemoEnforcementMiddleware({
        mode: 'explicitAllow',
        allowlist,
        logger: noopLogger,
      });
      const app = makeAppWithClaims(DEMO_CLAIMS_SHIPPER, mw);
      const res = await app.request('/me/profile', { method: 'POST' });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: string; code: string };
      expect(body.error).toBe('forbidden_demo');
      expect(body.code).toBe('forbidden_demo');
    });

    it('path matches pero method no → 403 forbidden_demo', async () => {
      const mw = createIsDemoEnforcementMiddleware({
        mode: 'explicitAllow',
        allowlist,
        logger: noopLogger,
      });
      const app = makeAppWithClaims(DEMO_CLAIMS_SHIPPER, mw);
      const res = await app.request('/feature-flags', { method: 'POST' });
      expect(res.status).toBe(403);
    });

    it('allowlist vacío + path cualquier → 403 (default-deny)', async () => {
      const mw = createIsDemoEnforcementMiddleware({
        mode: 'explicitAllow',
        allowlist: [],
        logger: noopLogger,
      });
      const app = makeAppWithClaims(DEMO_CLAIMS_SHIPPER, mw);
      const res = await app.request('/demo/login', { method: 'POST' });
      expect(res.status).toBe(403);
    });
  });

  describe('factory contract', () => {
    it('export createIsDemoEnforcementMiddleware existe y retorna MiddlewareHandler', () => {
      const mw = createIsDemoEnforcementMiddleware({
        mode: 'requireNotDemo',
        allowlist: [],
        logger: noopLogger,
      });
      expect(typeof mw).toBe('function');
    });

    it('allowlist es opcional (default vacío) cuando mode !== explicitAllow', () => {
      expect(() =>
        createIsDemoEnforcementMiddleware({
          mode: 'requireNotDemo',
          logger: noopLogger,
        }),
      ).not.toThrow();
    });
  });
});
