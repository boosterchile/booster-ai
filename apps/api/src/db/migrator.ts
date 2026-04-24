import type { Logger } from '@booster-ai/logger';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Db } from './client.js';

/**
 * Aplica migraciones pendientes al startup.
 *
 * Drizzle guarda el estado de migraciones en la tabla `__drizzle_migrations`.
 * Si no hay pendientes, no-op. Safe para correr en múltiples instancias de
 * Cloud Run simultáneamente (drizzle-kit usa advisory locks de Postgres).
 *
 * Las migraciones viven en `apps/api/drizzle/` y se generan con:
 *   pnpm --filter @booster-ai/api drizzle-kit generate
 */
export async function runMigrations(db: Db, logger: Logger): Promise<void> {
  const start = Date.now();
  logger.info('Running Drizzle migrations');
  await migrate(db, { migrationsFolder: './drizzle' });
  logger.info({ durationMs: Date.now() - start }, 'Migrations complete');
}
