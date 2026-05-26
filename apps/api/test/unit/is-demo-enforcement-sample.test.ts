import type { Logger } from '@booster-ai/logger';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { FirebaseClaims } from '../../src/middleware/firebase-auth.js';
import { ALLOWLISTED_PATHS } from '../../src/middleware/is-demo-allowlist.js';
import { createIsDemoEnforcementMiddleware } from '../../src/middleware/is-demo-enforcement.js';

/**
 * T3 SEC-001 Sprint 2b — Integration test T6 sample-per-group.
 *
 * Spec sec-001-cierre §10 T6 + plan-sprint-2b §3 T3 acceptance:
 *   - Muestrea ≥1 endpoint por grupo enumerado de los 22 mount points
 *     auth-required de server.ts (no 8-10 total como spec v3.0).
 *   - Sesión demo (firebaseClaims.custom.is_demo:true) → 403
 *     forbidden_demo en POST.
 *   - Sesión no-demo (firebaseClaims.custom = {}) → 200.
 *
 * Diseño: integration-style focused test que arma una Hono app
 * mirroring la estructura del wire de server.ts:
 *   - Un fake-firebase-auth middleware setea firebaseClaims según
 *     el modo del test (demo o no-demo).
 *   - createIsDemoEnforcementMiddleware(mode='requireNotDemo',
 *     allowlist=ALLOWLISTED_PATHS) — mismo wiring que server.ts T3.1.
 *   - Stub handlers para cada path de muestra (1 POST por grupo).
 *
 * No requiere DB ni Redis — está en test/integration/ porque integra
 * múltiples componentes (claims context + middleware + 22 paths) end-
 * to-end pero la única infra real es Hono. globalSetup pre-corre
 * (DB migrations) sin que estos tests lo usen — overhead aceptado.
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

const REAL_CLAIMS: FirebaseClaims = {
  uid: 'real-user',
  email: 'real@user.cl',
  emailVerified: true,
  name: 'Real User',
  picture: undefined,
  custom: {},
};

/**
 * Sample list — 1 representative endpoint per mount group de los 22
 * canónicos del audit T2a. Path + method elegidos para reflejar uses
 * de mutation reales del repo (writes que demo session no debería
 * poder hacer).
 */
const SAMPLE_PER_GROUP: Array<{ group: string; method: string; path: string }> = [
  { group: '/me', method: 'POST', path: '/me/profile' },
  { group: '/me/*', method: 'POST', path: '/me/push-subscription' },
  { group: '/me/cobra-hoy/*', method: 'POST', path: '/me/cobra-hoy/solicitar' },
  { group: '/me/liquidaciones', method: 'GET', path: '/me/liquidaciones' },
  { group: '/empresas/*', method: 'POST', path: '/empresas/onboarding' },
  { group: '/trip-requests-v2/*', method: 'POST', path: '/trip-requests-v2' },
  { group: '/offers/*', method: 'POST', path: '/offers/abc/accept' },
  { group: '/assignments/*', method: 'PATCH', path: '/assignments/abc/confirmar-entrega' },
  { group: '/certificates/*', method: 'POST', path: '/certificates' },
  {
    group: '/admin/dispositivos-pendientes/*',
    method: 'POST',
    path: '/admin/dispositivos-pendientes/abc/approve',
  },
  { group: '/admin/cobra-hoy/*', method: 'POST', path: '/admin/cobra-hoy/abc/desembolsar' },
  { group: '/admin/stakeholder-orgs/*', method: 'POST', path: '/admin/stakeholder-orgs' },
  { group: '/admin/site-settings/*', method: 'POST', path: '/admin/site-settings' },
  { group: '/admin/liquidaciones/*', method: 'POST', path: '/admin/liquidaciones/abc/reemit' },
  { group: '/admin/seed/*', method: 'POST', path: '/admin/seed' },
  { group: '/admin/matching/*', method: 'POST', path: '/admin/matching/backtest' },
  { group: '/admin/observability/*', method: 'POST', path: '/admin/observability/refresh' },
  { group: '/vehiculos/*', method: 'POST', path: '/vehiculos' },
  { group: '/conductores/*', method: 'POST', path: '/conductores' },
  { group: '/sucursales/*', method: 'POST', path: '/sucursales' },
  { group: '/documentos/*', method: 'POST', path: '/documentos' },
  { group: '/cumplimiento/*', method: 'POST', path: '/cumplimiento/abc' },
];

/**
 * Helper: arma una Hono app que mirror el wire de server.ts T3.1.
 * Mode `requireNotDemo` + ALLOWLISTED_PATHS canónicos. Fake-firebase-
 * auth setea claims según parámetro.
 */
function makeApp(claims: FirebaseClaims | null): Hono {
  const app = new Hono();
  const isDemoMw = createIsDemoEnforcementMiddleware({
    mode: 'requireNotDemo',
    allowlist: ALLOWLISTED_PATHS,
    logger: noopLogger,
  });
  // Fake-firebase-auth: setea claims si proveídas.
  app.use('*', async (c, next) => {
    if (claims) {
      c.set('firebaseClaims', claims);
    }
    await next();
  });
  app.use('*', isDemoMw);
  // Stub handlers para cada path en el sample list.
  for (const { method, path } of SAMPLE_PER_GROUP) {
    const handler = (c: Parameters<Parameters<typeof app.get>[1]>[0]) =>
      c.json({ ok: true, path, method });
    switch (method) {
      case 'GET':
        app.get(path, handler);
        break;
      case 'POST':
        app.post(path, handler);
        break;
      case 'PUT':
        app.put(path, handler);
        break;
      case 'PATCH':
        app.patch(path, handler);
        break;
      case 'DELETE':
        app.delete(path, handler);
        break;
    }
  }
  return app;
}

describe('integration: is-demo-enforcement sample-per-group (SC-1.3.5 T6)', () => {
  describe('sesión demo (is_demo:true) → 403 forbidden_demo en TODAS las mutations sampled', () => {
    for (const { group, method, path } of SAMPLE_PER_GROUP) {
      // Read-only paths (GET /me/liquidaciones) sí pasan con
      // requireNotDemo per spec — solo mutations bloqueadas.
      if (method === 'GET') {
        continue;
      }
      it(`${method} ${path} (group ${group}) → 403`, async () => {
        const app = makeApp(DEMO_CLAIMS);
        const res = await app.request(path, { method });
        expect(res.status).toBe(403);
        const body = (await res.json()) as { error: string; code: string };
        expect(body.error).toBe('forbidden_demo');
        expect(body.code).toBe('forbidden_demo');
      });
    }
  });

  describe('sesión no-demo (claims sin is_demo) → 200 en TODAS las mutations sampled', () => {
    for (const { group, method, path } of SAMPLE_PER_GROUP) {
      it(`${method} ${path} (group ${group}) → 200`, async () => {
        const app = makeApp(REAL_CLAIMS);
        const res = await app.request(path, { method });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { ok: boolean };
        expect(body.ok).toBe(true);
      });
    }
  });

  describe('request anonymous (sin firebaseClaims) → 200 (passthrough; auth happens upstream)', () => {
    it('POST /me/profile sin claims → 200 (middleware no es auth)', async () => {
      const app = makeApp(null);
      const res = await app.request('/me/profile', { method: 'POST' });
      expect(res.status).toBe(200);
    });
  });

  describe('demo session + GET → passthrough (idempotent-safe)', () => {
    it('GET /me/liquidaciones con demo claims → 200', async () => {
      const app = makeApp(DEMO_CLAIMS);
      const res = await app.request('/me/liquidaciones', { method: 'GET' });
      expect(res.status).toBe(200);
    });
  });

  describe('coverage acceptance', () => {
    it('sample list cubre los 22 mount points canónicos del audit T2a', () => {
      const expectedGroups = new Set([
        '/me',
        '/me/*',
        '/me/cobra-hoy/*',
        '/me/liquidaciones',
        '/empresas/*',
        '/trip-requests-v2/*',
        '/offers/*',
        '/assignments/*',
        '/certificates/*',
        '/admin/dispositivos-pendientes/*',
        '/admin/cobra-hoy/*',
        '/admin/stakeholder-orgs/*',
        '/admin/site-settings/*',
        '/admin/liquidaciones/*',
        '/admin/seed/*',
        '/admin/matching/*',
        '/admin/observability/*',
        '/vehiculos/*',
        '/conductores/*',
        '/sucursales/*',
        '/documentos/*',
        '/cumplimiento/*',
      ]);
      const sampledGroups = new Set(SAMPLE_PER_GROUP.map((s) => s.group));
      for (const expected of expectedGroups) {
        expect(sampledGroups.has(expected), `missing sample for group ${expected}`).toBe(true);
      }
      expect(sampledGroups.size).toBe(22);
    });
  });
});
