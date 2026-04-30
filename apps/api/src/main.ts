import { createLogger } from '@booster-ai/logger';
import { serve } from '@hono/node-server';
import { config } from './config.js';
import { createDb } from './db/client.js';
import { runMigrations } from './db/migrator.js';
import { createServer } from './server.js';
import { getFirebaseAuth } from './services/firebase.js';

const logger = createLogger({
  service: config.SERVICE_NAME,
  version: config.SERVICE_VERSION,
  level: config.LOG_LEVEL,
  pretty: config.NODE_ENV === 'development',
});

async function main(): Promise<void> {
  const { db, pool } = createDb({
    databaseUrl: config.DATABASE_URL,
    poolMax: config.DATABASE_POOL_MAX,
    connectTimeoutMs: config.DATABASE_CONNECT_TIMEOUT_MS,
  });

  // Correr migraciones antes de aceptar tráfico. Si falla, abortamos startup.
  // Cloud Run startup probe no ruteará hasta que el server esté listening.
  // Pasamos el pool (no el db wrapper) porque el migrator necesita un cliente
  // dedicado para advisory lock — ver db/migrator.ts.
  await runMigrations(pool, logger);

  // Firebase Auth singleton — usado por el middleware /me y los demás
  // endpoints user-facing. Lazy-init: la primera llamada a verifyIdToken
  // descarga JWKS de Firebase. ADC en Cloud Run, GOOGLE_APPLICATION_CREDENTIALS
  // en dev local.
  const firebaseAuth = getFirebaseAuth({ projectId: config.FIREBASE_PROJECT_ID });

  const app = createServer({ db, pool, firebaseAuth, logger });

  const server = serve(
    {
      fetch: app.fetch,
      port: config.PORT,
    },
    (info) => {
      logger.info({ port: info.port, env: config.NODE_ENV }, 'booster-ai api listening');
    },
  );

  // Graceful shutdown: drenar requests en vuelo + cerrar pool DB.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      logger.info({ signal }, 'shutdown signal received');
      server.close(() => {
        void pool.end().finally(() => process.exit(0));
      });
    });
  }
}

main().catch((err) => {
  logger.fatal({ err }, 'fatal startup error');
  process.exit(1);
});
