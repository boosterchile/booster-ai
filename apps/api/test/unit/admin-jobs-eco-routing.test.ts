import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/eco-routing-tiempo-real.js', () => ({
  barrerEcoRoutingTeltonika: vi.fn(async () => ({
    evaluadas: 2,
    resultados: { sugerida: 1, sin_congestion: 1 },
  })),
}));

const eco = await import('../../src/services/eco-routing-tiempo-real.js');
const { createAdminJobsRoutes } = await import('../../src/routes/admin-jobs.js');

const noop = (): void => undefined;
const logger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
} as never;

function app(ecoRouting?: boolean) {
  return createAdminJobsRoutes({
    db: {} as never,
    logger,
    twilioClient: null,
    contentSidChatUnread: null,
    webAppUrl: 'https://app.test',
    ...(ecoRouting
      ? {
          ecoRouting: {
            deps: { computeRoutes: vi.fn(), sendPush: vi.fn(), now: () => 0, throttle: new Map() },
            routesProjectId: 'p',
          },
        }
      : {}),
  });
}

describe('POST /admin/jobs/eco-routing-barrido (T10-23)', () => {
  it('flag OFF → skip sin barrer', async () => {
    const res = await app().request('/eco-routing-barrido', { method: 'POST' });
    expect(await res.json()).toEqual({ ok: true, skipped: 'flag_off' });
    expect(eco.barrerEcoRoutingTeltonika).not.toHaveBeenCalled();
  });

  it('flag ON → barre y devuelve el resumen', async () => {
    const res = await app(true).request('/eco-routing-barrido', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      evaluadas: 2,
      resultados: { sugerida: 1, sin_congestion: 1 },
    });
    expect(eco.barrerEcoRoutingTeltonika).toHaveBeenCalledWith(
      expect.objectContaining({ routesProjectId: 'p' }),
    );
  });
});
