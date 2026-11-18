import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const recordarMock = vi.fn();
vi.mock('../../src/services/recordar-vehiculo-pendiente.js', () => ({
  recordarVehiculoPendiente: (...a: unknown[]) => recordarMock(...a),
}));

const noop = (): void => undefined;
const logger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  child: () => logger,
} as never;

/** `config.ts` lee el env al importarse: cada caso importa el router de nuevo. */
async function buildApp(env: Record<string, string | undefined>) {
  vi.resetModules();
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
  const { createAdminJobsRoutes } = await import('../../src/routes/admin-jobs.js');
  const app = new Hono();
  app.route(
    '/admin/jobs',
    createAdminJobsRoutes({
      db: {} as never,
      logger,
      twilioClient: null,
      contentSidChatUnread: null,
      webAppUrl: 'https://app.test',
      publicarDocumentoSubido: null,
    }),
  );
  return app;
}

beforeEach(() => {
  recordarMock.mockReset();
});

describe('POST /admin/jobs/vehiculo-pendiente-recordatorio (§3.9)', () => {
  it('sin VAPID → 200 skipped, sin tocar la base', async () => {
    const app = await buildApp({
      WEBPUSH_VAPID_PUBLIC_KEY: undefined,
      WEBPUSH_VAPID_PRIVATE_KEY: undefined,
    });
    const res = await app.request('/admin/jobs/vehiculo-pendiente-recordatorio', {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, skipped: true, reason: 'webpush_no_configurado' });
    expect(recordarMock).not.toHaveBeenCalled();
  });

  it('con VAPID → recuerda y devuelve los conteos', async () => {
    recordarMock.mockResolvedValue({
      recordadosOficina: 2,
      avisadosGenerador: 1,
      fallidos: 0,
    });
    const app = await buildApp({
      WEBPUSH_VAPID_PUBLIC_KEY: 'pub',
      WEBPUSH_VAPID_PRIVATE_KEY: 'priv',
    });
    const res = await app.request('/admin/jobs/vehiculo-pendiente-recordatorio', {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      recordados_oficina: 2,
      avisados_generador: 1,
      fallidos: 0,
    });
    expect(recordarMock).toHaveBeenCalledOnce();
  });
});
