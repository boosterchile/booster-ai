import { createLogger } from '@booster-ai/logger';
import { serve } from '@hono/node-server';
import { crearApp } from './app.js';
import { crearVerificadorToken } from './auth.js';
import { loadConfig } from './config.js';

/**
 * matching-engine (T10-21): `POST /ranking` para apps/api (ID token +
 * Cloud Run IAM) y `GET /health`. Sin base de datos ni secretos.
 */
function main(): void {
  const config = loadConfig();
  const logger = createLogger({
    service: '@booster-ai/matching-engine',
    version: process.env.SERVICE_VERSION ?? '0.0.0-dev',
    level: config.LOG_LEVEL,
    pretty: config.NODE_ENV === 'development',
  });

  const app = crearApp({
    logger,
    verificarToken: crearVerificadorToken({
      audience: config.OIDC_AUDIENCE,
      allowedCallerSa: config.ALLOWED_CALLER_SA,
      logger,
    }),
  });

  const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
    logger.info({ port: info.port }, 'matching-engine listening');
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutdown requested');
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

try {
  main();
} catch (err) {
  createLogger({ service: '@booster-ai/matching-engine', level: 'fatal' }).fatal(
    { err },
    'Fatal startup error',
  );
  process.exit(1);
}
