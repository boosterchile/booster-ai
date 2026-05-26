import type { Logger } from '@booster-ai/logger';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { FirebaseClaims } from '../../src/middleware/firebase-auth.js';
import { createIsDemoEnforcementMiddleware } from '../../src/middleware/is-demo-enforcement.js';

/**
 * T3 SEC-001 Sprint 2b — Integration test T6b default-deny fixture.
 *
 * Spec sec-001-cierre §10 T6b + plan-sprint-2b §3 T3 acceptance:
 *   - Fixture: añade un POST endpoint nuevo `/test-unallowed` SIN
 *     entry correspondiente en allowlist + sin opt-in en explicitAllow.
 *   - Sesión demo (is_demo:true) hits ese endpoint → 403 forbidden_demo.
 *   - Sin code change adicional (la default-deny semantics aplica
 *     automáticamente).
 *
 * Propósito: demostrar que el wire es **default-deny** — agregar un
 * endpoint nuevo a un grupo wired NO requiere recordar agregar entry
 * al allowlist. El middleware bloquea por default; opt-in explícito
 * solo en el modo `explicitAllow` (que usamos en SC-1.3.2 amendment
 * v3.4 wire post-firebase-auth con mode requireNotDemo + allowlist
 * preempty para paths públicos).
 *
 * Defense-in-depth posture: si un PR futuro agrega POST /me/nuevo-
 * endpoint sin pensar en is_demo, el wire global ya lo bloquea para
 * demo sessions. El allowlist debe estar populated explícitamente
 * para autorizar acceso demo.
 *
 * Test relocado a `test/unit/` (PO decision 2026-05-26) porque no
 * requiere DB — globalSetup de test/integration/ fuerza DB migrations
 * que estos tests no usan.
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

const DEMO_CLAIMS: FirebaseClaims = {
  uid: 'demo-uid-shipper',
  email: 'demo-2026-shipper@boosterchile.com',
  emailVerified: false,
  name: 'Demo Shipper',
  picture: undefined,
  custom: { is_demo: true, persona: 'generador_carga' },
};

const NON_DEMO_CLAIMS: FirebaseClaims = {
  uid: 'real-user',
  email: 'real@user.cl',
  emailVerified: true,
  name: 'Real User',
  picture: undefined,
  custom: {},
};

describe('integration: is-demo default-deny fixture (SC-1.3.6 T6b)', () => {
  describe('mode=requireNotDemo (wire default de server.ts T3.1)', () => {
    it('endpoint nuevo no enumerado + demo session → 403 forbidden_demo', async () => {
      const app = new Hono();
      const isDemoMw = createIsDemoEnforcementMiddleware({
        mode: 'requireNotDemo',
        allowlist: [], // allowlist vacía irrelevante en requireNotDemo
        logger: noopLogger,
      });
      app.use('*', async (c, next) => {
        c.set('firebaseClaims', DEMO_CLAIMS);
        await next();
      });
      app.use('*', isDemoMw);
      app.post('/test-unallowed', (c) => c.json({ ok: true }));

      const res = await app.request('/test-unallowed', { method: 'POST' });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: string; code: string };
      expect(body.error).toBe('forbidden_demo');
      expect(body.code).toBe('forbidden_demo');
    });

    it('endpoint nuevo no enumerado + no-demo session → 200 (default-deny solo aplica a demo)', async () => {
      const app = new Hono();
      const isDemoMw = createIsDemoEnforcementMiddleware({
        mode: 'requireNotDemo',
        allowlist: [],
        logger: noopLogger,
      });
      app.use('*', async (c, next) => {
        c.set('firebaseClaims', NON_DEMO_CLAIMS);
        await next();
      });
      app.use('*', isDemoMw);
      app.post('/test-unallowed', (c) => c.json({ ok: true }));

      const res = await app.request('/test-unallowed', { method: 'POST' });
      expect(res.status).toBe(200);
    });

    it('GET en endpoint nuevo + demo session → 200 (idempotent-safe passthrough)', async () => {
      const app = new Hono();
      const isDemoMw = createIsDemoEnforcementMiddleware({
        mode: 'requireNotDemo',
        allowlist: [],
        logger: noopLogger,
      });
      app.use('*', async (c, next) => {
        c.set('firebaseClaims', DEMO_CLAIMS);
        await next();
      });
      app.use('*', isDemoMw);
      app.get('/test-unallowed-readonly', (c) => c.json({ ok: true }));

      const res = await app.request('/test-unallowed-readonly', { method: 'GET' });
      expect(res.status).toBe(200);
    });
  });

  describe('mode=explicitAllow (default-deny estricto, allowlist vacía o sin match)', () => {
    it('allowlist vacía + demo session + cualquier método → 403', async () => {
      const app = new Hono();
      const isDemoMw = createIsDemoEnforcementMiddleware({
        mode: 'explicitAllow',
        allowlist: [],
        logger: noopLogger,
      });
      app.use('*', async (c, next) => {
        c.set('firebaseClaims', DEMO_CLAIMS);
        await next();
      });
      app.use('*', isDemoMw);
      app.get('/anywhere', (c) => c.json({ ok: true }));
      app.post('/anywhere', (c) => c.json({ ok: true }));

      const getRes = await app.request('/anywhere', { method: 'GET' });
      expect(getRes.status).toBe(403);
      const postRes = await app.request('/anywhere', { method: 'POST' });
      expect(postRes.status).toBe(403);
    });

    it('allowlist con un entry + demo session + path sin match → 403', async () => {
      const app = new Hono();
      const isDemoMw = createIsDemoEnforcementMiddleware({
        mode: 'explicitAllow',
        allowlist: [
          {
            path: '/specifically-allowed',
            methods: ['POST'],
            rationale: 'fixture allowlist for default-deny test',
            reviewBy: '2099-01-01',
          },
        ],
        logger: noopLogger,
      });
      app.use('*', async (c, next) => {
        c.set('firebaseClaims', DEMO_CLAIMS);
        await next();
      });
      app.use('*', isDemoMw);
      app.post('/other-path', (c) => c.json({ ok: true }));

      const res = await app.request('/other-path', { method: 'POST' });
      expect(res.status).toBe(403);
    });
  });
});
