import type { Logger } from '@booster-ai/logger';
import { Hono } from 'hono';
import type pg from 'pg';
import { config } from '../config.js';

/**
 * Health endpoints — públicos (sin auth middleware), montados directo bajo `/`.
 *
 * /health  — liveness: el proceso está vivo, basta para que el LB no reinicie.
 * /ready   — readiness: el proceso puede aceptar tráfico real (DB ok). Si esto
 *            devuelve 503, Cloud Run o el LB pueden retirar la instancia del
 *            pool sin matar el container (degradación temporal del DB no debe
 *            tirar el service entero).
 *
 * api no usa Redis directamente — sólo el bot lo usa para conversation store.
 * Por eso /ready chequea sólo Postgres.
 */
export function createHealthRouter(opts: { pool: pg.Pool; logger: Logger }): Hono {
  const { pool, logger } = opts;
  const app = new Hono();

  app.get('/health', (c) =>
    c.json({
      status: 'ok',
      service: config.SERVICE_NAME,
      version: config.SERVICE_VERSION,
      timestamp: new Date().toISOString(),
    }),
  );

  app.get('/ready', async (c) => {
    // SELECT 1 con timeout corto — readiness probe no debe colgarse.
    // Si Postgres no responde en 2s, marcamos NOT READY (503).
    const start = Date.now();
    let dbOk = false;
    let dbError: string | undefined;
    try {
      const client = await pool.connect();
      try {
        await client.query('SELECT 1');
        dbOk = true;
      } finally {
        client.release();
      }
    } catch (err) {
      dbError = err instanceof Error ? err.message : String(err);
      logger.warn({ err }, 'readiness check failed: postgres');
    }

    const latencyMs = Date.now() - start;
    const body = {
      status: dbOk ? ('ready' as const) : ('not_ready' as const),
      checks: {
        process: 'ok' as const,
        database: dbOk ? ('ok' as const) : ('fail' as const),
        ...(dbError ? { database_error: dbError } : {}),
      },
      latency_ms: latencyMs,
      timestamp: new Date().toISOString(),
    };
    return c.json(body, dbOk ? 200 : 503);
  });

  return app;
}
