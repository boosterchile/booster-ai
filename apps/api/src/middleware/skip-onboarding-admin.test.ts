import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { describe, expect, it } from 'vitest';
import { ONBOARDING_ADMIN_PATH, skipOnboardingAdmin } from './skip-onboarding-admin.js';

/**
 * alta-cliente-autocontenida — `POST /empresas/onboarding-admin` completa el
 * alta con el token one-shot como única credencial, así que no puede quedar
 * detrás del chain de Firebase: una persona que todavía no existe en la
 * plataforma no tiene sesión que ofrecer.
 *
 * El resto de `/empresas/*` sigue exigiendo el chain completo.
 */

/** Middleware espía tipado (vi.fn no satisface `MiddlewareHandler`). */
function spyMiddleware() {
  const state = { calls: 0 };
  const mw: MiddlewareHandler = async (_c, next) => {
    state.calls += 1;
    await next();
  };
  return { mw, state };
}

function buildApp(mw: MiddlewareHandler) {
  const app = new Hono();
  app.use('/empresas/*', skipOnboardingAdmin(mw));
  app.post('/empresas/onboarding-admin', (c) => c.json({ ok: 'admin' }));
  app.post('/empresas/onboarding', (c) => c.json({ ok: 'self' }));
  app.get('/empresas/onboarding-admin', (c) => c.json({ ok: 'get' }));
  return app;
}

describe('skipOnboardingAdmin', () => {
  it('deja pasar el alta con token sin ejecutar el middleware de auth', async () => {
    const { mw, state } = spyMiddleware();
    const res = await buildApp(mw).request('/empresas/onboarding-admin', { method: 'POST' });

    expect(res.status).toBe(200);
    expect(state.calls).toBe(0);
  });

  it('mantiene el middleware en el resto de /empresas/*', async () => {
    const { mw, state } = spyMiddleware();
    await buildApp(mw).request('/empresas/onboarding', { method: 'POST' });

    expect(state.calls).toBe(1);
  });

  it('solo exceptúa POST — un GET al mismo path sigue pasando por auth', async () => {
    const { mw, state } = spyMiddleware();
    await buildApp(mw).request('/empresas/onboarding-admin', { method: 'GET' });

    expect(state.calls).toBe(1);
  });

  it('el patrón no matchea sub-paths ni mounts ajenos', () => {
    expect(ONBOARDING_ADMIN_PATH.test('/empresas/onboarding-admin')).toBe(true);
    expect(ONBOARDING_ADMIN_PATH.test('/empresas/onboarding-admin/otra')).toBe(false);
    expect(ONBOARDING_ADMIN_PATH.test('/empresas/onboarding')).toBe(false);
    expect(ONBOARDING_ADMIN_PATH.test('/otro/onboarding-admin')).toBe(false);
  });
});
