import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from '@booster-ai/logger';
import { sql } from 'drizzle-orm';
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

const MIGRATIONS_FOLDER = './drizzle';
const MIGRATIONS_SCHEMA = 'drizzle';
const MIGRATIONS_TABLE = '__drizzle_migrations';

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface JournalFile {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

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
 * --- Validación pre-apply (ADR-pending) ---
 *
 * Bug detectado 2026-05-13: el migrator de Drizzle compara `lastDbMigration.created_at <
 * migration.folderMillis` para decidir si aplica una migración. Si los timestamps del
 * `meta/_journal.json` NO son monotónicamente crecientes vs el orden cronológico
 * de merge a main, Drizzle skipea migraciones silenciosamente.
 *
 * Reproducción del incident:
 *   - PR-A crea migrations 0030+0031 (timestamp T0)
 *   - PR-B crea migration 0032 (timestamp T1 > T0)
 *   - PR-B mergea primero → 0032 se aplica, lastDbMigration.created_at = T1
 *   - PR-A mergea después → 0030+0031 tienen folderMillis = T0 < T1 → SKIPPED
 *   - Drizzle reporta "Migrations complete" sin aplicar nada
 *   - Columnas declaradas en schema TS pero no en BD → queries 500
 *
 * Fix: pre-verificamos integridad ANTES de llamar a `migrate()`:
 *   1. Leer journal entries del disco.
 *   2. Leer hashes ya aplicadas de `drizzle.__drizzle_migrations`.
 *   3. Computar hash de cada migration en disco.
 *   4. Si HAY una entry del journal cuyo hash NO esté en la BD → es pending
 *      pero Drizzle puede skipearla → la aplicamos manualmente en transacción.
 *
 * Esto NO compite con `migrate()` regular — funciona como tolerancia a un bug
 * upstream. Cuando Drizzle aplique correctamente, simplemente no encontramos
 * pendings y `migrate()` corre como antes.
 */
export async function runMigrations(pool: pg.Pool, logger: Logger): Promise<void> {
  const client = await pool.connect();
  try {
    logger.info('Acquiring migration advisory lock');
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);

    const migrationDb = drizzle(client, { schema });

    // 1. Drizzle normal (puede skipear out-of-order; tolerable)
    const start = Date.now();
    logger.info('Running Drizzle migrations');
    await migrate(migrationDb, { migrationsFolder: MIGRATIONS_FOLDER });
    logger.info({ durationMs: Date.now() - start }, 'Drizzle migrate() complete');

    // 2. Validación + recuperación de pending out-of-order
    const recovered = await applyOutOfOrderPending(migrationDb, logger);
    if (recovered.length > 0) {
      logger.warn(
        { recovered, count: recovered.length },
        'Recovered out-of-order pending migrations skipped by Drizzle (bug upstream)',
      );
    }
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    } catch (err) {
      logger.warn({ err }, 'Failed to release migration advisory lock (non-fatal)');
    }
    client.release();
  }
}

/**
 * Detecta migrations del journal cuyo hash NO está en `drizzle.__drizzle_migrations`
 * y las aplica en una sola transacción. Retorna los tags aplicados.
 *
 * Idempotente: si nada está pending, no toca la BD.
 */
async function applyOutOfOrderPending(
  // biome-ignore lint/suspicious/noExplicitAny: drizzle types
  db: any,
  logger: Logger,
): Promise<string[]> {
  const journalPath = path.join(MIGRATIONS_FOLDER, 'meta', '_journal.json');
  if (!fs.existsSync(journalPath)) {
    logger.warn({ journalPath }, 'Migration journal not found; skipping recovery');
    return [];
  }

  const journal: JournalFile = JSON.parse(fs.readFileSync(journalPath, 'utf-8'));
  const entries = journal.entries ?? [];
  if (entries.length === 0) {
    return [];
  }

  // Hashes ya aplicados en la BD.
  let appliedHashes: Set<string>;
  try {
    const result = await db.execute(
      sql.raw(`SELECT hash FROM "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"`),
    );
    // node-postgres devuelve { rows } o ResultIterator según versión
    const rows: Array<{ hash: string }> = result.rows ?? result;
    appliedHashes = new Set(rows.map((r) => r.hash));
  } catch (err) {
    // Si la tabla no existe es porque ningún migrate ha corrido nunca; deja a Drizzle.
    logger.debug({ err }, 'Could not read __drizzle_migrations; skipping recovery check');
    return [];
  }

  const recovered: string[] = [];
  for (const entry of entries) {
    const sqlPath = path.join(MIGRATIONS_FOLDER, `${entry.tag}.sql`);
    if (!fs.existsSync(sqlPath)) {
      logger.warn({ tag: entry.tag, sqlPath }, 'Journal entry references missing SQL file');
      continue;
    }
    const sqlContent = fs.readFileSync(sqlPath, 'utf-8');
    const hash = crypto.createHash('sha256').update(sqlContent).digest('hex');

    if (appliedHashes.has(hash)) {
      continue; // ya aplicada
    }

    logger.warn(
      { tag: entry.tag, hash, when: entry.when },
      'Pending migration not in __drizzle_migrations — applying via recovery path',
    );

    // Aplicar en transacción única: SQL + INSERT del marker.
    // Drizzle separa statements con `--> statement-breakpoint`. Replicamos.
    const statements = sqlContent
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    await db.transaction(async (tx: typeof db) => {
      for (const stmt of statements) {
        await tx.execute(sql.raw(stmt));
      }
      await tx.execute(
        sql.raw(
          `INSERT INTO "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" ("hash", "created_at") VALUES ('${hash}', ${entry.when})`,
        ),
      );
    });
    recovered.push(entry.tag);
  }

  return recovered;
}
