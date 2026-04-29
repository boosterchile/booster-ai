import type { Logger } from '@booster-ai/logger';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import * as schema from './schema.js';

/**
 * Advisory lock key arbitrario y único para migraciones del API.
 * Postgres acepta un solo bigint o dos int4. Usamos un int dentro del rango
 * seguro de JS Number (< 2^53) para no necesitar BigInt en la query.
 */
const MIGRATION_LOCK_KEY = 938472561;

/**
 * Aplica migraciones pendientes al startup, protegidas por advisory lock.
 *
 * Drizzle no implementa locks por sí solo: cuando varias instancias de
 * Cloud Run arrancan simultáneamente y todas corren `migrate()`, dos pueden
 * intentar `CREATE TYPE foo` al mismo tiempo y la segunda falla con
 * `duplicate key value violates unique constraint "pg_type_typname_nsp_index"`.
 *
 * Solución: tomar un solo cliente del pool, adquirir un advisory lock
 * a nivel de session (pg_advisory_lock), correr el migrator usando ESE
 * mismo cliente (drizzle envuelve el client directamente, no el pool, así
 * el lock aplica a las queries del migrator), y liberar al final.
 *
 * Otros instances que llegan acá esperan en pg_advisory_lock hasta que el
 * primero termina. Cuando el lock libera, drizzle ve que las migraciones
 * ya están aplicadas en `__drizzle_migrations` y hace no-op.
 */
export async function runMigrations(pool: pg.Pool, logger: Logger): Promise<void> {
  const client = await pool.connect();
  try {
    logger.info('Acquiring migration advisory lock');
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);

    const migrationDb = drizzle(client, { schema });
    const start = Date.now();
    logger.info('Running Drizzle migrations');
    await migrate(migrationDb, { migrationsFolder: './drizzle' });
    logger.info({ durationMs: Date.now() - start }, 'Migrations complete');
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    } catch (err) {
      logger.warn({ err }, 'Failed to release migration advisory lock (non-fatal)');
    }
    client.release();
  }
}
