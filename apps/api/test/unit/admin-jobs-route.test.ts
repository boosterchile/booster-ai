import { Hono } from 'hono';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
});

vi.mock('../../src/services/chat-whatsapp-fallback.js', () => ({
  procesarMensajesNoLeidos: vi.fn(),
}));

const { procesarMensajesNoLeidos } = await import('../../src/services/chat-whatsapp-fallback.js');

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: noop,
  child: () => noopLogger,
} as never;

async function buildApp() {
  const { createAdminJobsRoutes } = await import('../../src/routes/admin-jobs.js');
  const app = new Hono();
  app.route(
    '/admin/jobs',
    createAdminJobsRoutes({
      db: {} as never,
      logger: noopLogger,
      twilioClient: null,
      contentSidChatUnread: null,
      webAppUrl: 'https://app.test',
    }),
  );
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /admin/jobs/chat-whatsapp-fallback', () => {
  it('happy path: 200 con counts del service', async () => {
    (procesarMensajesNoLeidos as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      candidates: 5,
      notified: 3,
      skippedNoOwner: 1,
      skippedNoWhatsapp: 1,
      errored: 0,
    });
    const app = await buildApp();
    const res = await app.request('/admin/jobs/chat-whatsapp-fallback', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; notified: number };
    expect(body.ok).toBe(true);
    expect(body.notified).toBe(3);
  });

  it('service retorna 0 candidatos: igual 200 ok=true', async () => {
    (procesarMensajesNoLeidos as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      candidates: 0,
      notified: 0,
      skippedNoOwner: 0,
      skippedNoWhatsapp: 0,
      errored: 0,
    });
    const app = await buildApp();
    const res = await app.request('/admin/jobs/chat-whatsapp-fallback', { method: 'POST' });
    expect(res.status).toBe(200);
  });
});
