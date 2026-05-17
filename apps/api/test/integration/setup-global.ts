import { createLogger } from '@booster-ai/logger';
import pg from 'pg';
import { runMigrations } from '../../src/db/migrator.js';

/**
 * vitest globalSetup para integration tests. Corre UNA vez antes del primer
 * worker, NO una vez por test ni por archivo. Por eso vive separado del
 * `setup.integration.ts` (que sí corre por archivo).
 *
 * Secuencia (validada en T0, ver docs/handoff/2026-05-17-t0-prototype-test-db-output.md):
 *   1. DROP SCHEMA public CASCADE — tira todas las tablas de dominio.
 *   2. DROP SCHEMA drizzle CASCADE — tira __drizzle_migrations (el plan §D2
 *      omitió este DROP; T0 reveló que sin él la idempotencia in-place se
 *      degrada porque sobreviven hashes viejos).
 *   3. CREATE SCHEMA public + GRANT.
 *   4. CREATE EXTENSION pgcrypto (las migrations asumen que está disponible).
 *   5. runMigrations(pool, logger) real de apps/api/src/db/migrator.ts —
 *      mismo código que prod, incluyendo advisory lock + applyOutOfOrderPending.
 *
 * Timing medido en T0: ~500ms cold, ~100ms warm reset. Bajo el budget plan §T1b
 * de <15s para globalSetup + 2 tests.
 *
 * Si `TEST_DATABASE_URL` no está definido o apunta a prod/staging, falla
 * inmediatamente con mensaje claro. La validación duplica la del helper
 * `createTestDb` porque globalSetup corre en un proceso distinto del de
 * los tests; preferimos un error temprano y específico.
 */
export default async function setup(): Promise<() => Promise<void>> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL no está definido. Exporta una conexión a Postgres local antes de correr tests integration. Ver apps/api/test/integration/README.md (T5b).',
    );
  }
  if (/prod|staging/i.test(url)) {
    throw new Error(
      `TEST_DATABASE_URL parece apuntar a una BD compartida (prod/staging). Aborto. URL: ${url.replace(/:[^:@]*@/, ':***@')}`,
    );
  }

  const logger = createLogger({
    service: 'integration-test-setup',
    version: '0.0.0-test',
    level: 'error',
    pretty: false,
  });

  const pool = new pg.Pool({ connectionString: url, max: 2 });
  try {
    const client = await pool.connect();
    try {
      await client.query('DROP SCHEMA IF EXISTS public CASCADE');
      await client.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
      await client.query('CREATE SCHEMA public');
      await client.query('GRANT ALL ON SCHEMA public TO CURRENT_USER');
      await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    } finally {
      client.release();
    }
    await runMigrations(pool, logger);
  } finally {
    await pool.end();
  }

  // Teardown: vitest llama esta función al final de la corrida. No tenemos
  // recursos persistentes a liberar (cada test integration crea su propio
  // pool vía createTestDb), pero firmamos el contrato globalSetup → teardown
  // por si T3+ agregan recursos compartidos.
  return async () => {
    // intentionally empty — placeholder para teardown futuro de T3+
  };
}
