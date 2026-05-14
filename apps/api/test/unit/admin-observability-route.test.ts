import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config as appConfig } from '../../src/config.js';
import {
  type AdminObservabilityRoutesOpts,
  createAdminObservabilityRoutes,
} from '../../src/routes/admin-observability.js';
import type { UserContext } from '../../src/services/user-context.js';

/**
 * Integration tests del router /admin/observability/* — coverage:
 *  - 503 si feature flag OFF
 *  - 401 si no hay userContext
 *  - 403 si email no es platform admin
 *  - 200 + payload si admin + flag ON
 *  - 502 si provider falla
 *  - 400 si query inválido
 *  - graceful degradation Twilio/Workspace
 *
 * Mocks: cada servicio del package observability se reemplaza por un
 * stub con `vi.fn()`. No tocamos red ni Redis.
 */

const ADMIN_EMAIL = 'dev@boosterchile.com';
const NON_ADMIN_EMAIL = 'random@example.com';

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  child: () => noopLogger,
} as never;

function makeUserCtx(email: string): UserContext {
  return {
    user: { id: 'u1', firebaseUid: 'fb1', fullName: 'Felipe', email },
    activeMembership: null,
    memberships: [],
  } as unknown as UserContext;
}

function buildOpts(
  overrides?: Partial<AdminObservabilityRoutesOpts>,
): AdminObservabilityRoutesOpts {
  const defaults: AdminObservabilityRoutesOpts = {
    costsService: {
      getOverview: vi.fn(async () => ({
        costClpMonthToDate: 100000,
        costClpPreviousMonth: 90000,
        deltaPercentVsPreviousMonth: 11.1,
        lastBillingExportAt: '2026-05-13T13:00:00Z',
      })),
      getByService: vi.fn(async () => [
        { service: 'Cloud Run', costClp: 60000, percentOfTotal: 60 },
      ]),
      getByProject: vi.fn(async () => [
        {
          projectId: 'booster-ai-494222',
          projectName: 'booster-ai',
          costClp: 75000,
          percentOfTotal: 75,
        },
      ]),
      getTrend: vi.fn(async () => [{ date: '2026-05-13', costClp: 5000 }]),
      getTopSkus: vi.fn(async () => [{ service: 'Cloud Run', sku: 'CPU', costClp: 30000 }]),
    } as any,
    monitoringService: {
      getCloudRunMetrics: vi.fn(async () => ({
        latencyP95Ms: 150,
        cpuUtilization: 0.4,
        ramUtilization: 0.5,
        rps: 8,
      })),
      getCloudSqlMetrics: vi.fn(async () => ({
        cpuUtilization: 0.3,
        ramUtilization: 0.4,
        diskUtilization: 0.5,
        connectionsUsedRatio: 0.2,
      })),
      getUptimeSnapshot: vi.fn(async () => ({
        uptimePercent: 99.9,
        totalChecks: 3,
        lastSampleAt: '2026-05-13T20:00:00Z',
      })),
    } as any,
    twilioUsageService: {
      getBalance: vi.fn(async () => ({ balanceUsd: 42.5, balanceClp: 39313, currency: 'USD' })),
      getMonthToDateUsage: vi.fn(async () => [
        {
          category: 'sms',
          description: 'SMS',
          usage: 100,
          usageUnit: 'messages',
          priceUsd: 5,
          priceClp: 4625,
        },
      ]),
    } as any,
    workspaceService: {
      getUsageSnapshot: vi.fn(async () => ({
        available: true,
        totalSeats: 10,
        activeSeats: 9,
        suspendedSeats: 1,
        seatsBySku: { '1010020028': 9 },
        monthlyCostUsd: 108,
        monthlyCostClp: 99900,
      })),
    } as any,
    forecastService: {
      forecast: vi.fn(() => ({
        forecastClpEndOfMonth: 1000000,
        budgetClp: 925000,
        variancePercent: 8.1,
        dayOfMonth: 15,
        daysInMonth: 30,
        daysRemaining: 15,
      })),
    } as any,
    healthChecksService: {
      getSnapshot: vi.fn(async () => ({
        overall: 'healthy' as const,
        components: [{ name: 'uptime', level: 'healthy' as const, message: '99.9%' }],
        lastEvaluatedAt: '2026-05-13T20:00:00Z',
      })),
    } as any,
    fxRateService: {
      getCurrentRate: vi.fn(async () => ({
        clpPerUsd: 925,
        observedAt: '2026-05-13T00:00:00Z',
        source: 'mindicador' as const,
      })),
    } as any,
    monthlyBudgetUsd: 1000,
    featureFlag: true,
    logger: noopLogger,
  };
  return { ...defaults, ...overrides };
}

function makeApp(
  opts: AdminObservabilityRoutesOpts,
  ctx: { email?: string; withContext: boolean },
) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (ctx.withContext) {
      c.set('userContext', makeUserCtx(ctx.email ?? ADMIN_EMAIL));
    }
    await next();
  });
  app.route('/admin/observability', createAdminObservabilityRoutes(opts));
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  appConfig.BOOSTER_PLATFORM_ADMIN_EMAILS = [ADMIN_EMAIL];
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('admin/observability — auth + feature flag', () => {
  it('503 si feature flag OFF', async () => {
    const app = makeApp(buildOpts({ featureFlag: false }), {
      withContext: true,
      email: ADMIN_EMAIL,
    });
    const res = await app.request('/admin/observability/health');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'feature_disabled' });
  });

  it('401 si sin userContext (Firebase auth missing)', async () => {
    const app = makeApp(buildOpts(), { withContext: false });
    const res = await app.request('/admin/observability/health');
    expect(res.status).toBe(401);
  });

  it('403 si email no es platform admin', async () => {
    const app = makeApp(buildOpts(), {
      withContext: true,
      email: NON_ADMIN_EMAIL,
    });
    const res = await app.request('/admin/observability/health');
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('forbidden_platform_admin');
  });
});

describe('admin/observability — happy paths', () => {
  it('GET /health → 200 + snapshot', async () => {
    const app = makeApp(buildOpts(), { withContext: true });
    const res = await app.request('/admin/observability/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { overall: string };
    expect(body.overall).toBe('healthy');
  });

  it('GET /costs/overview → 200 + delta%', async () => {
    const app = makeApp(buildOpts(), { withContext: true });
    const res = await app.request('/admin/observability/costs/overview');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { costClpMonthToDate: number };
    expect(body.costClpMonthToDate).toBe(100000);
  });

  it('GET /costs/by-service?days=30 → 200 + items array', async () => {
    const opts = buildOpts();
    const app = makeApp(opts, { withContext: true });
    const res = await app.request('/admin/observability/costs/by-service?days=30');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { days: number; items: Array<unknown> };
    expect(body.days).toBe(30);
    expect(body.items).toHaveLength(1);
    expect(opts.costsService.getByService).toHaveBeenCalledWith(30);
  });

  it('GET /costs/by-project sin query → days default 30', async () => {
    const opts = buildOpts();
    const app = makeApp(opts, { withContext: true });
    const res = await app.request('/admin/observability/costs/by-project');
    expect(res.status).toBe(200);
    expect(opts.costsService.getByProject).toHaveBeenCalledWith(30);
  });

  it('GET /costs/trend?days=7 → 200 + points', async () => {
    const app = makeApp(buildOpts(), { withContext: true });
    const res = await app.request('/admin/observability/costs/trend?days=7');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { points: Array<{ date: string }> };
    expect(body.points[0]?.date).toBe('2026-05-13');
  });

  it('GET /costs/top-skus?limit=5 → 200', async () => {
    const opts = buildOpts();
    const app = makeApp(opts, { withContext: true });
    const res = await app.request('/admin/observability/costs/top-skus?limit=5');
    expect(res.status).toBe(200);
    expect(opts.costsService.getTopSkus).toHaveBeenCalledWith(5);
  });

  it('GET /usage/cloud-run → 200 + metrics', async () => {
    const app = makeApp(buildOpts(), { withContext: true });
    const res = await app.request('/admin/observability/usage/cloud-run');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cpuUtilization: number };
    expect(body.cpuUtilization).toBe(0.4);
  });

  it('GET /usage/cloud-sql → 200 + metrics', async () => {
    const app = makeApp(buildOpts(), { withContext: true });
    const res = await app.request('/admin/observability/usage/cloud-sql');
    expect(res.status).toBe(200);
  });

  it('GET /usage/twilio → 200 + balance + usage', async () => {
    const app = makeApp(buildOpts(), { withContext: true });
    const res = await app.request('/admin/observability/usage/twilio');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { available: boolean; balance: { balanceUsd: number } };
    expect(body.available).toBe(true);
    expect(body.balance.balanceUsd).toBe(42.5);
  });

  it('GET /usage/twilio sin service configurado → available=false', async () => {
    const app = makeApp(buildOpts({ twilioUsageService: null }), { withContext: true });
    const res = await app.request('/admin/observability/usage/twilio');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { available: boolean; reason: string };
    expect(body.available).toBe(false);
    expect(body.reason).toBe('twilio_credentials_not_configured');
  });

  it('GET /usage/workspace → 200 + snapshot', async () => {
    const app = makeApp(buildOpts(), { withContext: true });
    const res = await app.request('/admin/observability/usage/workspace');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { available: boolean; totalSeats: number };
    expect(body.available).toBe(true);
    expect(body.totalSeats).toBe(10);
  });

  it('GET /forecast → 200 + forecast + currentRate', async () => {
    const app = makeApp(buildOpts(), { withContext: true });
    const res = await app.request('/admin/observability/forecast');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      forecastClpEndOfMonth: number;
      currentRate: { clpPerUsd: number };
    };
    expect(body.forecastClpEndOfMonth).toBe(1000000);
    expect(body.currentRate.clpPerUsd).toBe(925);
  });
});

describe('admin/observability — error paths', () => {
  it('GET /costs/overview con BQ caído → 502', async () => {
    const opts = buildOpts({
      costsService: {
        getOverview: vi.fn(async () => {
          throw new Error('BQ unavailable');
        }),
        getByService: vi.fn(),
        getByProject: vi.fn(),
        getTrend: vi.fn(),
        getTopSkus: vi.fn(),
      } as any,
    });
    const app = makeApp(opts, { withContext: true });
    const res = await app.request('/admin/observability/costs/overview');
    expect(res.status).toBe(502);
  });

  it('GET /costs/by-service?days=abc → 400 invalid_query', async () => {
    const app = makeApp(buildOpts(), { withContext: true });
    const res = await app.request('/admin/observability/costs/by-service?days=abc');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_query');
  });

  it('GET /costs/by-service?days=99999 → 400 (out of range)', async () => {
    const app = makeApp(buildOpts(), { withContext: true });
    const res = await app.request('/admin/observability/costs/by-service?days=99999');
    expect(res.status).toBe(400);
  });
});
