import type { Logger } from '@booster-ai/logger';
import { Hono } from 'hono';
import { z } from 'zod';
import { requirePlatformAdmin } from '../middleware/require-platform-admin.js';
import type { CostsService } from '../services/observability/costs-service.js';
import type { ForecastService } from '../services/observability/forecast-service.js';
import type { FxRateService } from '../services/observability/fx-rate-service.js';
import type { HealthChecksService } from '../services/observability/health-checks-service.js';
import type { MonitoringService } from '../services/observability/monitoring-service.js';
import type { TwilioUsageService } from '../services/observability/twilio-usage-service.js';
import type { WorkspaceService } from '../services/observability/workspace-service.js';

/**
 * Router /admin/observability/* — dashboard de observabilidad para
 * platform-admin Booster (spec 2026-05-13).
 *
 * Auth: BOOSTER_PLATFORM_ADMIN_EMAILS allowlist (via requirePlatformAdmin).
 * Feature flag: OBSERVABILITY_DASHBOARD_ACTIVATED. Si false → 503 antes
 * de tocar BigQuery o cualquier API externa (kill-switch).
 *
 * Endpoints (11):
 *   GET /health                  — composite snapshot (uptime + run + sql)
 *   GET /costs/overview          — MTD + previous month + delta% (CLP)
 *   GET /costs/by-service?days=N — breakdown por servicio GCP
 *   GET /costs/by-project?days=N — breakdown por GCP project
 *   GET /costs/trend?days=N      — serie diaria
 *   GET /costs/top-skus?limit=N  — top SKUs del mes
 *   GET /usage/cloud-run         — latencia + CPU + RAM + RPS
 *   GET /usage/cloud-sql         — CPU + RAM + disco + ratio conexiones
 *   GET /usage/twilio            — balance + top categorías
 *   GET /usage/workspace         — seats + costo mensual (DWD requerido)
 *   GET /forecast                — extrapolación fin de mes vs budget
 */

const rangeQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
});
const limitQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export interface AdminObservabilityRoutesOpts {
  costsService: CostsService;
  monitoringService: MonitoringService;
  /** null si las credentials de Twilio no están configuradas. */
  twilioUsageService: TwilioUsageService | null;
  workspaceService: WorkspaceService;
  forecastService: ForecastService;
  healthChecksService: HealthChecksService;
  fxRateService: FxRateService;
  monthlyBudgetUsd: number;
  /** OBSERVABILITY_DASHBOARD_ACTIVATED. */
  featureFlag: boolean;
  logger: Logger;
}

export function createAdminObservabilityRoutes(opts: AdminObservabilityRoutesOpts) {
  const app = new Hono();
  const guard = () => ({ featureFlag: opts.featureFlag });

  app.get('/health', async (c) => {
    const auth = requirePlatformAdmin(c, guard());
    if (!auth.ok) {
      return auth.response;
    }
    try {
      const snapshot = await opts.healthChecksService.getSnapshot();
      return c.json(snapshot);
    } catch (err) {
      opts.logger.error(
        { err: err instanceof Error ? err.message : String(err), adminEmail: auth.adminEmail },
        'admin/observability/health failed',
      );
      return c.json({ error: 'internal_error' }, 500);
    }
  });

  app.get('/costs/overview', async (c) => {
    const auth = requirePlatformAdmin(c, guard());
    if (!auth.ok) {
      return auth.response;
    }
    try {
      const result = await opts.costsService.getOverview();
      return c.json(result);
    } catch (err) {
      opts.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'admin/observability/costs/overview failed',
      );
      return c.json({ error: 'costs_unavailable' }, 502);
    }
  });

  app.get('/costs/by-service', async (c) => {
    const auth = requirePlatformAdmin(c, guard());
    if (!auth.ok) {
      return auth.response;
    }
    const parsed = rangeQuerySchema.safeParse({ days: c.req.query('days') });
    if (!parsed.success) {
      return c.json({ error: 'invalid_query', details: parsed.error.flatten() }, 400);
    }
    try {
      const result = await opts.costsService.getByService(parsed.data.days);
      return c.json({ days: parsed.data.days, items: result });
    } catch (err) {
      opts.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'admin/observability/costs/by-service failed',
      );
      return c.json({ error: 'costs_unavailable' }, 502);
    }
  });

  app.get('/costs/by-project', async (c) => {
    const auth = requirePlatformAdmin(c, guard());
    if (!auth.ok) {
      return auth.response;
    }
    const parsed = rangeQuerySchema.safeParse({ days: c.req.query('days') });
    if (!parsed.success) {
      return c.json({ error: 'invalid_query', details: parsed.error.flatten() }, 400);
    }
    try {
      const result = await opts.costsService.getByProject(parsed.data.days);
      return c.json({ days: parsed.data.days, items: result });
    } catch (err) {
      opts.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'admin/observability/costs/by-project failed',
      );
      return c.json({ error: 'costs_unavailable' }, 502);
    }
  });

  app.get('/costs/trend', async (c) => {
    const auth = requirePlatformAdmin(c, guard());
    if (!auth.ok) {
      return auth.response;
    }
    const parsed = rangeQuerySchema.safeParse({ days: c.req.query('days') });
    if (!parsed.success) {
      return c.json({ error: 'invalid_query', details: parsed.error.flatten() }, 400);
    }
    try {
      const result = await opts.costsService.getTrend(parsed.data.days);
      return c.json({ days: parsed.data.days, points: result });
    } catch (err) {
      opts.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'admin/observability/costs/trend failed',
      );
      return c.json({ error: 'costs_unavailable' }, 502);
    }
  });

  app.get('/costs/top-skus', async (c) => {
    const auth = requirePlatformAdmin(c, guard());
    if (!auth.ok) {
      return auth.response;
    }
    const parsed = limitQuerySchema.safeParse({ limit: c.req.query('limit') });
    if (!parsed.success) {
      return c.json({ error: 'invalid_query', details: parsed.error.flatten() }, 400);
    }
    try {
      const result = await opts.costsService.getTopSkus(parsed.data.limit);
      return c.json({ limit: parsed.data.limit, items: result });
    } catch (err) {
      opts.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'admin/observability/costs/top-skus failed',
      );
      return c.json({ error: 'costs_unavailable' }, 502);
    }
  });

  app.get('/usage/cloud-run', async (c) => {
    const auth = requirePlatformAdmin(c, guard());
    if (!auth.ok) {
      return auth.response;
    }
    try {
      const result = await opts.monitoringService.getCloudRunMetrics();
      return c.json(result);
    } catch (err) {
      opts.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'admin/observability/usage/cloud-run failed',
      );
      return c.json({ error: 'monitoring_unavailable' }, 502);
    }
  });

  app.get('/usage/cloud-sql', async (c) => {
    const auth = requirePlatformAdmin(c, guard());
    if (!auth.ok) {
      return auth.response;
    }
    try {
      const result = await opts.monitoringService.getCloudSqlMetrics();
      return c.json(result);
    } catch (err) {
      opts.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'admin/observability/usage/cloud-sql failed',
      );
      return c.json({ error: 'monitoring_unavailable' }, 502);
    }
  });

  app.get('/usage/twilio', async (c) => {
    const auth = requirePlatformAdmin(c, guard());
    if (!auth.ok) {
      return auth.response;
    }
    if (!opts.twilioUsageService) {
      return c.json({ available: false, reason: 'twilio_credentials_not_configured' });
    }
    try {
      const [balance, usage] = await Promise.all([
        opts.twilioUsageService.getBalance(),
        opts.twilioUsageService.getMonthToDateUsage(),
      ]);
      return c.json({ available: true, balance, usage });
    } catch (err) {
      opts.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'admin/observability/usage/twilio failed',
      );
      return c.json({ error: 'twilio_unavailable' }, 502);
    }
  });

  app.get('/usage/workspace', async (c) => {
    const auth = requirePlatformAdmin(c, guard());
    if (!auth.ok) {
      return auth.response;
    }
    try {
      const result = await opts.workspaceService.getUsageSnapshot();
      return c.json(result);
    } catch (err) {
      opts.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'admin/observability/usage/workspace failed',
      );
      return c.json({ available: false, reason: 'internal_error' });
    }
  });

  app.get('/forecast', async (c) => {
    const auth = requirePlatformAdmin(c, guard());
    if (!auth.ok) {
      return auth.response;
    }
    try {
      const [overview, fx] = await Promise.all([
        opts.costsService.getOverview(),
        opts.fxRateService.getCurrentRate(),
      ]);
      const forecast = opts.forecastService.forecast({
        mtdCostClp: overview.costClpMonthToDate,
        budgetUsd: opts.monthlyBudgetUsd,
        clpPerUsd: fx.clpPerUsd,
      });
      return c.json({
        ...forecast,
        currentRate: fx,
      });
    } catch (err) {
      opts.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'admin/observability/forecast failed',
      );
      return c.json({ error: 'forecast_unavailable' }, 502);
    }
  });

  return app;
}
