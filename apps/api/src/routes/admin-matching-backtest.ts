import type { Logger } from '@booster-ai/logger';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { requirePlatformAdmin } from '../middleware/require-platform-admin.js';
import {
  BacktestRunNotFoundError,
  getBacktestRun,
  listBacktestRuns,
  runBacktest,
} from '../services/matching-backtest.js';

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
 * Audiencia: platform-admin (`requirePlatformAdmin`), el mismo guard que
 * las demás rutas admin.
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

  // POST /admin/matching/backtest — dispara corrida.
  app.post('/backtest', async (c) => {
    const auth = requirePlatformAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }

    const bodyRaw = await c.req.json().catch(() => ({}));
    const parsed = runRequestSchema.safeParse(bodyRaw);
    if (!parsed.success) {
      return c.json({ error: 'validation', detail: z.treeifyError(parsed.error) }, 400);
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
