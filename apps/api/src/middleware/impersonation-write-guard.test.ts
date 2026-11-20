import type { Logger } from '@booster-ai/logger';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { UserContext } from '../services/user-context.js';
import type { FirebaseClaims } from './firebase-auth.js';
import { createImpersonationWriteGuardMiddleware } from './impersonation-write-guard.js';

/**
 * Tests del middleware impersonation-write-guard.
 *
 * Decisión SELLADA con el PO (impersonación auditada) + DESACOPLE ADR-053:
 *   - Una sesión impersonada (custom claim `impersonated_by` presente) puede
 *     LEER cualquier empresa del target (GET/HEAD/OPTIONS passthrough), pero
 *     solo puede ESCRIBIR (POST/PUT/PATCH/DELETE) cuando la empresa activa
 *     (`userContext.activeMembership.empresa.isTestUser` = `es_usuario_prueba`)
 *     es de usuarios de prueba. `es_demo` YA NO autoriza.
 *   - Empresa real, demo legacy, o sin userContext resoluble + método mutante
 *     → 403 (fail-closed).
 *   - Sesión normal (sin `impersonated_by`) → passthrough SIEMPRE (no rompe la
 *     escritura normal de usuarios reales).
 *
 * Atribución (criterio de auditoría): el guard emite un log estructurado con
 * `impersonated_by` en CADA mutación impersonada — tanto las bloqueadas
 * (`auth.impersonation.write_blocked`) como las permitidas sobre empresa de
 * prueba (`auth.impersonation.write_allowed`). Así toda mutación impersonada es
 * atribuible al admin.
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

const ADMIN_ID = '0b5f6e2a-4c1d-4e8f-9a3b-7c6d5e4f3a2b';
const LISTA_RESPALDO = ['respaldo@boosterchile.com'];

const IMPERSONATED_CLAIMS: FirebaseClaims = {
  uid: 'target-firebase-uid',
  email: undefined,
  emailVerified: false,
  name: undefined,
  picture: undefined,
  custom: { impersonated_by: ADMIN_ID },
};

const NORMAL_CLAIMS: FirebaseClaims = {
  uid: 'real-user-uid',
  email: 'real@user.cl',
  emailVerified: true,
  name: 'Real',
  picture: undefined,
  custom: {},
};

const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;

/**
 * Construye un userContext mínimo con la empresa activa marcada con los flags
 * dados. La AUTORIZACIÓN de escritura impersonada depende SOLO de
 * `es_usuario_prueba` (isTestUser); `es_demo` (isDemo) NO autoriza (desacople
 * ADR-053).
 */
function userContextWith(flags: { isDemo?: boolean; isTestUser?: boolean }): UserContext {
  return {
    user: { id: 'target-uuid' },
    memberships: [],
    activeMembership: {
      membership: {},
      empresa: { id: 'e1', isDemo: flags.isDemo ?? false, isTestUser: flags.isTestUser ?? false },
    },
    impersonatedBy: ADMIN_ID,
  } as unknown as UserContext;
}

/**
 * BD mínima para la lectura de quien impersona (`.specs/bordes-autenticacion`
 * SC4). Por defecto, un admin marcado y activo.
 */
function dbConAdmin(fila: Record<string, unknown> | null = ADMIN_CON_ACCESO) {
  const limit = vi.fn(async () => (fila ? [fila] : []));
  const select = vi.fn(() => ({ from: () => ({ where: () => ({ limit }) }) }));
  return { db: { select } as never, select };
}

const ADMIN_CON_ACCESO = {
  email: 'ana@boosterchile.com',
  isPlatformAdmin: true,
  status: 'activo',
};

/**
 * Arma una app Hono que opcionalmente setea firebaseClaims + userContext,
 * aplica el guard bajo test y expone handlers por método.
 */
function makeApp(opts: {
  claims: FirebaseClaims | null;
  userContext?: UserContext | null;
  logger?: Logger;
  db?: ReturnType<typeof dbConAdmin>['db'];
}) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (opts.claims) {
      c.set('firebaseClaims', opts.claims);
    }
    if (opts.userContext) {
      c.set('userContext', opts.userContext);
    }
    await next();
  });
  app.use(
    '*',
    createImpersonationWriteGuardMiddleware({
      logger: opts.logger ?? noopLogger,
      db: opts.db ?? dbConAdmin().db,
      platformAdminEmails: LISTA_RESPALDO,
    }),
  );
  app.get('/x', (c) => c.json({ ok: true }));
  app.on('HEAD', '/x', (c) => c.body(null, 200));
  app.post('/x', (c) => c.json({ ok: true }));
  app.put('/x', (c) => c.json({ ok: true }));
  app.patch('/x', (c) => c.json({ ok: true }));
  app.delete('/x', (c) => c.json({ ok: true }));
  return app;
}

describe('impersonation-write-guard middleware', () => {
  describe('sesión normal (sin impersonated_by)', () => {
    it('passthrough en TODOS los métodos mutantes (no rompe escritura real)', async () => {
      const app = makeApp({ claims: NORMAL_CLAIMS, userContext: userContextWith({}) });
      for (const method of MUTATING_METHODS) {
        const res = await app.request('/x', { method });
        expect(res.status, method).toBe(200);
      }
    });

    it('claim ausente (request sin firebase-auth previo) → passthrough', async () => {
      const app = makeApp({ claims: null });
      const res = await app.request('/x', { method: 'POST' });
      expect(res.status).toBe(200);
    });
  });

  describe('sesión impersonada + método de lectura', () => {
    it('GET passthrough aunque la empresa activa NO sea demo (lecturas en cualquier empresa)', async () => {
      const app = makeApp({
        claims: IMPERSONATED_CLAIMS,
        userContext: userContextWith({}),
      });
      const res = await app.request('/x', { method: 'GET' });
      expect(res.status).toBe(200);
    });

    it('HEAD passthrough con empresa real', async () => {
      const app = makeApp({
        claims: IMPERSONATED_CLAIMS,
        userContext: userContextWith({}),
      });
      const res = await app.request('/x', { method: 'HEAD' });
      expect(res.status).toBe(200);
    });
  });

  describe('sesión impersonada + método mutante + empresa NO demo', () => {
    it('POST/PUT/PATCH/DELETE → 403 forbidden_impersonation_write en CADA método', async () => {
      const app = makeApp({
        claims: IMPERSONATED_CLAIMS,
        userContext: userContextWith({}),
      });
      for (const method of MUTATING_METHODS) {
        const res = await app.request('/x', { method });
        expect(res.status, method).toBe(403);
        const body = (await res.json()) as { error: string; code: string };
        expect(body.error, method).toBe('forbidden_impersonation_write');
        expect(body.code, method).toBe('forbidden_impersonation_write');
      }
    });
  });

  describe('sesión impersonada + método mutante + SIN userContext (fail-closed)', () => {
    it('POST → 403: no se puede confirmar es_demo, se bloquea', async () => {
      const app = makeApp({ claims: IMPERSONATED_CLAIMS, userContext: null });
      const res = await app.request('/x', { method: 'POST' });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe('forbidden_impersonation_write');
    });

    it('POST con activeMembership null → 403 (fail-closed)', async () => {
      const ctx = {
        user: { id: 'target-uuid' },
        memberships: [],
        activeMembership: null,
        impersonatedBy: ADMIN_ID,
      } as unknown as UserContext;
      const app = makeApp({ claims: IMPERSONATED_CLAIMS, userContext: ctx });
      const res = await app.request('/x', { method: 'POST' });
      expect(res.status).toBe(403);
    });
  });

  describe('sesión impersonada + método mutante + empresa es_usuario_prueba (permitido)', () => {
    it('POST/PUT/PATCH/DELETE → passthrough sobre empresa es_usuario_prueba=true', async () => {
      const app = makeApp({
        claims: IMPERSONATED_CLAIMS,
        userContext: userContextWith({ isTestUser: true }),
      });
      for (const method of MUTATING_METHODS) {
        const res = await app.request('/x', { method });
        expect(res.status, method).toBe(200);
      }
    });
  });

  describe('DESACOPLE ADR-053: es_demo ya NO autoriza escritura impersonada', () => {
    it('empresa legacy es_demo=true pero es_usuario_prueba=false → 403 en CADA método mutante', async () => {
      // Rojo de seguridad: si el guard siguiera keyeado en es_demo, esto
      // permitiría MUTAR data de una empresa demo legacy bajo identidad
      // impersonada. Solo es_usuario_prueba debe autorizar.
      const app = makeApp({
        claims: IMPERSONATED_CLAIMS,
        userContext: userContextWith({ isDemo: true, isTestUser: false }),
      });
      for (const method of MUTATING_METHODS) {
        const res = await app.request('/x', { method });
        expect(res.status, method).toBe(403);
        const body = (await res.json()) as { code: string };
        expect(body.code, method).toBe('forbidden_impersonation_write');
      }
    });

    it('empresa real de cliente (es_demo=false, es_usuario_prueba=false) → 403 (data real protegida)', async () => {
      const app = makeApp({
        claims: IMPERSONATED_CLAIMS,
        userContext: userContextWith({ isDemo: false, isTestUser: false }),
      });
      const res = await app.request('/x', { method: 'PATCH' });
      expect(res.status).toBe(403);
    });
  });

  describe('atribución / auditoría (log estructurado con impersonated_by)', () => {
    function makeSpyLogger() {
      const warn = vi.fn();
      const info = vi.fn();
      const spy = {
        trace: noop,
        debug: noop,
        info,
        warn,
        error: noop,
        fatal: noop,
        child: () => spy,
      } as unknown as Logger;
      return { logger: spy, warn, info };
    }

    it('mutación BLOQUEADA → warn auth.impersonation.write_blocked con impersonated_by + uid + path + method', async () => {
      const { logger, warn } = makeSpyLogger();
      const app = makeApp({
        claims: IMPERSONATED_CLAIMS,
        userContext: userContextWith({}),
        logger,
      });
      const res = await app.request('/x', {
        method: 'POST',
        headers: { 'X-Cloud-Trace-Context': 'trace-abc/1;o=1' },
      });
      expect(res.status).toBe(403);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toMatchObject({
        event: 'auth.impersonation.write_blocked',
        impersonated_by: ADMIN_ID,
        uid: 'target-firebase-uid',
        path: '/x',
        method: 'POST',
        correlationId: 'trace-abc',
      });
    });

    it('mutación PERMITIDA sobre empresa demo → log auth.impersonation.write_allowed con impersonated_by', async () => {
      const { logger, info, warn } = makeSpyLogger();
      const app = makeApp({
        claims: IMPERSONATED_CLAIMS,
        userContext: userContextWith({ isTestUser: true }),
        logger,
      });
      const res = await app.request('/x', { method: 'POST' });
      expect(res.status).toBe(200);
      const emitted = [...info.mock.calls, ...warn.mock.calls];
      const attribution = emitted.find(
        (call) => (call[0] as { event?: string })?.event === 'auth.impersonation.write_allowed',
      );
      expect(attribution, 'debe emitir un log de atribución').toBeDefined();
      expect(attribution?.[0]).toMatchObject({
        event: 'auth.impersonation.write_allowed',
        impersonated_by: ADMIN_ID,
        method: 'POST',
      });
    });

    it('lectura impersonada (GET) → NO emite log (solo mutaciones se auditan acá)', async () => {
      const { logger, warn, info } = makeSpyLogger();
      const app = makeApp({
        claims: IMPERSONATED_CLAIMS,
        userContext: userContextWith({}),
        logger,
      });
      await app.request('/x', { method: 'GET' });
      expect(warn).not.toHaveBeenCalled();
      expect(info).not.toHaveBeenCalled();
    });

    it('sesión normal mutante → NO emite log de impersonación', async () => {
      const { logger, warn, info } = makeSpyLogger();
      const app = makeApp({
        claims: NORMAL_CLAIMS,
        userContext: userContextWith({}),
        logger,
      });
      await app.request('/x', { method: 'POST' });
      expect(warn).not.toHaveBeenCalled();
      expect(info).not.toHaveBeenCalled();
    });
  });

  describe('factory contract', () => {
    it('createImpersonationWriteGuardMiddleware retorna un MiddlewareHandler', () => {
      const mw = createImpersonationWriteGuardMiddleware({
        logger: noopLogger,
        db: dbConAdmin().db,
        platformAdminEmails: LISTA_RESPALDO,
      });
      expect(typeof mw).toBe('function');
    });
  });
});

/**
 * `.specs/bordes-autenticacion` SC4 — la impersonación vale mientras quien
 * impersona tenga acceso al panel, con la regla única de acceso.
 */
describe('impersonation-write-guard — quien impersona sigue con acceso (SC4)', () => {
  const REVOCADA = { error: 'unauthorized', code: 'impersonation_revoked' };

  it.each([
    [
      'sin la marca y fuera de la lista',
      { email: 'ana@boosterchile.com', isPlatformAdmin: false, status: 'activo' },
    ],
    [
      'marcado pero suspendido',
      { email: 'ana@boosterchile.com', isPlatformAdmin: true, status: 'suspendido' },
    ],
    ['inexistente', null],
  ])('quien impersona %s → 401 impersonation_revoked, también en lecturas', async (_caso, fila) => {
    const app = makeApp({
      claims: IMPERSONATED_CLAIMS,
      userContext: userContextWith({ isTestUser: true }),
      db: dbConAdmin(fila).db,
    });
    for (const method of ['GET', 'POST'] as const) {
      const res = await app.request('/x', { method });
      expect(res.status, method).toBe(401);
      expect(await res.json()).toEqual(REVOCADA);
    }
  });

  it('quien impersona con acceso por la lista de respaldo sigue igual', async () => {
    const app = makeApp({
      claims: IMPERSONATED_CLAIMS,
      userContext: userContextWith({ isTestUser: true }),
      db: dbConAdmin({
        email: 'Respaldo@BoosterChile.com',
        isPlatformAdmin: false,
        status: 'activo',
      }).db,
    });
    expect((await app.request('/x', { method: 'GET' })).status).toBe(200);
    expect((await app.request('/x', { method: 'POST' })).status).toBe(200);
  });

  it('un claim que no es un id válido → 401 sin consultar la base', async () => {
    const d = dbConAdmin();
    const app = makeApp({
      claims: { ...IMPERSONATED_CLAIMS, custom: { impersonated_by: 'no-es-un-uuid' } },
      userContext: userContextWith({ isTestUser: true }),
      db: d.db,
    });
    const res = await app.request('/x', { method: 'GET' });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(REVOCADA);
    expect(d.select).not.toHaveBeenCalled();
  });

  it('una sesión normal no consulta a nadie', async () => {
    const d = dbConAdmin();
    const app = makeApp({ claims: NORMAL_CLAIMS, userContext: userContextWith({}), db: d.db });
    expect((await app.request('/x', { method: 'POST' })).status).toBe(200);
    expect(d.select).not.toHaveBeenCalled();
  });
});
