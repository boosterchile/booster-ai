import { Hono } from 'hono';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
});

vi.mock('../../src/services/chat-whatsapp-fallback.js', () => ({
  procesarMensajesNoLeidos: vi.fn(),
}));

vi.mock('../../src/services/procesar-cobranza-cobra-hoy.js', () => ({
  procesarCobranzaCobraHoy: vi.fn(),
}));

const { procesarMensajesNoLeidos } = await import('../../src/services/chat-whatsapp-fallback.js');
const { procesarCobranzaCobraHoy } = await import(
  '../../src/services/procesar-cobranza-cobra-hoy.js'
);
const { config: appConfig } = await import('../../src/config.js');

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

describe('POST /admin/jobs/cobra-hoy-cobranza', () => {
  beforeEach(() => {
    appConfig.FACTORING_V1_ACTIVATED = true;
  });

  it('flag off → 200 skipped:true sin invocar service', async () => {
    appConfig.FACTORING_V1_ACTIVATED = false;
    const app = await buildApp();
    const res = await app.request('/admin/jobs/cobra-hoy-cobranza', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; skipped: boolean; reason: string };
    expect(body).toEqual({ ok: true, skipped: true, reason: 'feature_disabled' });
    expect(procesarCobranzaCobraHoy).not.toHaveBeenCalled();
  });

  it('happy path: 200 con counts y adelantos serializados', async () => {
    (procesarCobranzaCobraHoy as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      morasCreadas: 2,
      adelantos: [
        {
          adelantoId: 'a1',
          empresaCarrierId: 'c1',
          empresaShipperId: 's1',
          diasVencidos: 5,
        },
        {
          adelantoId: 'a2',
          empresaCarrierId: 'c2',
          empresaShipperId: 's2',
          diasVencidos: 12,
        },
      ],
    });
    const app = await buildApp();
    const res = await app.request('/admin/jobs/cobra-hoy-cobranza', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      moras_creadas: number;
      adelantos: Array<{ adelanto_id: string; dias_vencidos: number }>;
    };
    expect(body.ok).toBe(true);
    expect(body.moras_creadas).toBe(2);
    expect(body.adelantos).toEqual([
      {
        adelanto_id: 'a1',
        empresa_carrier_id: 'c1',
        empresa_shipper_id: 's1',
        dias_vencidos: 5,
      },
      {
        adelanto_id: 'a2',
        empresa_carrier_id: 'c2',
        empresa_shipper_id: 's2',
        dias_vencidos: 12,
      },
    ]);
  });

  it('cero candidatos: 200 con moras_creadas=0', async () => {
    (procesarCobranzaCobraHoy as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      morasCreadas: 0,
      adelantos: [],
    });
    const app = await buildApp();
    const res = await app.request('/admin/jobs/cobra-hoy-cobranza', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { moras_creadas: number; adelantos: unknown[] };
    expect(body.moras_creadas).toBe(0);
    expect(body.adelantos).toEqual([]);
  });
});
