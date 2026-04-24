import { type NodePgDatabase, drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;

export interface DbConfig {
  databaseUrl: string;
  poolMax: number;
  connectTimeoutMs: number;
}

/**
 * Crea el pool + instancia de Drizzle. Se llama UNA vez en main.ts y se pasa
 * por context de Hono a los handlers. Nunca crear múltiples pools por proceso.
 */
export function createDb(config: DbConfig): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: config.poolMax,
    connectionTimeoutMillis: config.connectTimeoutMs,
    // Cloud SQL proxy + SSL: la connection string trae `sslmode=require`, pg
    // lo respeta pero no valida cert issuer por defecto. Esto es OK en Cloud
    // Run con private IP por VPC connector (el link privado ya es de confianza).
  });

  const db = drizzle(pool, { schema });
  return { db, pool };
}
