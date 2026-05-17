import { type NodePgDatabase, drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '../../src/db/schema.js';

export type TestDb = NodePgDatabase<typeof schema>;

export interface TestDbHandle {
  db: TestDb;
  pool: pg.Pool;
  url: string;
}

/**
 * Crea un pool de Postgres dedicado a integration tests apuntando a
 * `TEST_DATABASE_URL` del environment. Rechaza si la URL parece apuntar
 * a producción o staging — el script T0 estableció que el reset incluye
 * `DROP SCHEMA public CASCADE` + `DROP SCHEMA drizzle CASCADE`, una operación
 * irreversible si se ejecuta contra una BD real.
 *
 * Devuelve también `url` para diagnostics — los helpers de cleanup la
 * usan para incluirla en mensajes de error.
 */
export function createTestDb(): TestDbHandle {
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

  const pool = new pg.Pool({
    connectionString: url,
    max: 2,
    connectionTimeoutMillis: 5_000,
  });
  const db = drizzle(pool, { schema });
  return { db, pool, url };
}
