import { Hono } from 'hono';
import { config } from '../config.js';

export const healthRouter = new Hono();

/**
 * Liveness — el proceso está vivo.
 */
healthRouter.get('/health', (c) =>
  c.json({
    status: 'ok',
    service: config.SERVICE_NAME,
    version: config.SERVICE_VERSION,
    timestamp: new Date().toISOString(),
  }),
);

/**
 * Readiness — el proceso puede aceptar tráfico.
 * TODO: verificar conexión a Postgres + Redis antes de devolver 200.
 */
healthRouter.get('/ready', (c) =>
  c.json({
    status: 'ready',
    checks: {
      process: 'ok',
      // database: TODO
      // redis: TODO
    },
    timestamp: new Date().toISOString(),
  }),
);
