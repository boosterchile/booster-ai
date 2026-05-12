import type { Logger } from '@booster-ai/logger';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import { config as appConfig } from '../config.js';
import type { Db } from '../db/client.js';
import {
  BacktestRunNotFoundError,
  getBacktestRun,
  listBacktestRuns,
  runBacktest,
} from '../services/matching-backtest.js';
import type { UserContext } from '../services/user-context.js';

/**
 * Endpoints platform-admin para gestionar corridas de backtest del
 * matching engine v2 (ADR-033 §8).
 *
 *   POST /admin/matching/backtest
 *     → Dispara una corrida síncrona. Body opcional:
 *       { tripsDesde?: ISO, tripsHasta?: ISO, tripsLimit?: number,
 *         pesos?: { capacidad, backhaul, reputacion, tier } }
 *     → Response: { id, resumen }
 *
 *   GET /admin/matching/backtest
 *     → Lista las últimas 25 corridas (preview).
 *
 *   GET /admin/matching/backtest/:id
 *     → Detalle completo (incluye resultados por trip).
 *
 * Audiencia: emails en `BOOSTER_PLATFORM_ADMIN_EMAILS`. Misma gate que
 * los otros admin routes (seed, jobs, liquidaciones).
 */

const runRequestSchema = z.object({
  tripsDesde: z
    .string()
    .datetime({ offset: true })
    .optional()
    .nullable()
    .transform((v) => (v ? new Date(v) : null)),
  tripsHasta: z
    .string()
    .datetime({ offset: true })
    .optional()
    .nullable()
    .transform((v) => (v ? new Date(v) : null)),
  tripsLimit: z.number().int().min(1).max(5000).optional(),
  pesos: z
    .object({
      capacidad: z.number().min(0).max(1),
      backhaul: z.number().min(0).max(1),
      reputacion: z.number().min(0).max(1),
      tier: z.number().min(0).max(1),
    })
    .optional(),
});

export function createAdminMatchingBacktestRoutes(opts: { db: Db; logger: Logger }) {
  const app = new Hono();

  // biome-ignore lint/suspicious/noExplicitAny: hono Context genéricos.
  function requirePlatformAdmin(c: Context<any, any, any>) {
    const userContext = c.get('userContext') as UserContext | undefined;
    if (!userContext) {
      return { ok: false as const, response: c.json({ error: 'unauthorized' }, 401) };
    }
    const email = userContext.user.email?.toLowerCase();
    const allowlist = appConfig.BOOSTER_PLATFORM_ADMIN_EMAILS;
    if (!email || !allowlist.includes(email)) {
      return {
        ok: false as const,
        response: c.json({ error: 'forbidden_platform_admin' }, 403),
      };
    }
    return { ok: true as const, adminEmail: email };
  }

  // POST /admin/matching/backtest — dispara corrida.
  app.post('/backtest', async (c) => {
    const auth = requirePlatformAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }

    const bodyRaw = await c.req.json().catch(() => ({}));
    const parsed = runRequestSchema.safeParse(bodyRaw);
    if (!parsed.success) {
      return c.json({ error: 'validation', detail: parsed.error.format() }, 400);
    }

    opts.logger.info(
      { adminEmail: auth.adminEmail, body: parsed.data },
      'admin/matching/backtest POST',
    );

    try {
      const result = await runBacktest({
        db: opts.db,
        logger: opts.logger,
        createdByEmail: auth.adminEmail,
        tripsDesde: parsed.data.tripsDesde,
        tripsHasta: parsed.data.tripsHasta,
        tripsLimit: parsed.data.tripsLimit ?? 500,
        pesos: parsed.data.pesos,
      });
      return c.json({ ok: true, id: result.id, resumen: result.resumen });
    } catch (err) {
      opts.logger.error({ err }, 'admin/matching/backtest POST failed');
      return c.json({ error: 'backtest_failed', detail: (err as Error).message }, 500);
    }
  });

  // GET /admin/matching/backtest — lista.
  app.get('/backtest', async (c) => {
    const auth = requirePlatformAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }

    const limitParam = c.req.query('limit');
    const limit = limitParam ? Math.min(Math.max(Number(limitParam) || 25, 1), 100) : 25;

    try {
      const runs = await listBacktestRuns({ db: opts.db, limit });
      return c.json({ ok: true, runs });
    } catch (err) {
      opts.logger.error({ err }, 'admin/matching/backtest GET failed');
      return c.json({ error: 'list_failed', detail: (err as Error).message }, 500);
    }
  });

  // GET /admin/matching/backtest/:id — detalle.
  app.get('/backtest/:id', async (c) => {
    const auth = requirePlatformAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }

    const id = c.req.param('id');
    if (!id || !/^[0-9a-f-]{36}$/.test(id)) {
      return c.json({ error: 'invalid_id' }, 400);
    }

    try {
      const run = await getBacktestRun({ db: opts.db, id });
      return c.json({ ok: true, run });
    } catch (err) {
      // Check por name además de instanceof: en tests con vi.mock las
      // instancias pueden diferir aun siendo la misma clase lógica.
      const notFound =
        err instanceof BacktestRunNotFoundError ||
        (err instanceof Error && err.name === 'BacktestRunNotFoundError');
      if (notFound) {
        return c.json({ error: 'not_found' }, 404);
      }
      opts.logger.error({ err, id }, 'admin/matching/backtest/:id failed');
      return c.json({ error: 'fetch_failed', detail: (err as Error).message }, 500);
    }
  });

  return app;
}
