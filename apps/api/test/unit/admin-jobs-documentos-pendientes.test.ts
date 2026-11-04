import { Hono } from 'hono';
import { beforeAll, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
});

vi.mock('../../src/services/reconciliar-documentos-pendientes.js', () => ({
  reconciliarDocumentosPendientes: vi.fn(),
}));

const { reconciliarDocumentosPendientes } = await import(
  '../../src/services/reconciliar-documentos-pendientes.js'
);

const noop = (): void => undefined;
const logger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: vi.fn(),
  error: noop,
  fatal: noop,
  child: () => logger,
} as never;

async function buildApp(publicarDocumentoSubido: (() => Promise<void>) | null) {
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
      publicarDocumentoSubido,
    }),
  );
  return app;
}

describe('POST /admin/jobs/documentos-pendientes (T10-21)', () => {
  it('sin topic configurado → 200 skipped, sin tocar la base', async () => {
    const app = await buildApp(null);
    const res = await app.request('/admin/jobs/documentos-pendientes', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, skipped: true, reason: 'topic_not_configured' });
    expect(reconciliarDocumentosPendientes).not.toHaveBeenCalled();
  });

  it('con topic → corre la reconciliación y devuelve los conteos', async () => {
    vi.mocked(reconciliarDocumentosPendientes).mockResolvedValueOnce({
      liberados: 1,
      republicados: 3,
      fallidosPublicacion: 0,
    });
    const publicar = vi.fn(async () => undefined);
    const app = await buildApp(publicar);
    const res = await app.request('/admin/jobs/documentos-pendientes', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      liberados: 1,
      republicados: 3,
      fallidos_publicacion: 0,
    });
    expect(reconciliarDocumentosPendientes).toHaveBeenCalledWith(
      expect.objectContaining({ publicar }),
    );
  });
});
