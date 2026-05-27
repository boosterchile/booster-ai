import pg from 'pg';

/**
 * Sprint 2c-A T6 — lazy-initialized `pg.Pool` singleton.
 *
 * The Cloud Function Gen 1 runtime instantiates one Node.js process per
 * container; module-level singletons survive across invocations within
 * that container. Lazy initialization (vs eager) means:
 *
 *   - Cold-start cost: no DB connection attempt at module load. First
 *     invocation pays the connect overhead; subsequent invocations on
 *     the same container reuse the pool.
 *   - Test ergonomics: importing `db.ts` does not require
 *     `DATABASE_URL` to be set. Tests can `vi.mock('./db.js')` cleanly.
 *
 * Connection target (Sprint 2c-B wires the unix-socket form via
 * Terraform):
 *   `DATABASE_URL=postgresql://user:pass@/dbname?host=/cloudsql/<conn-name>`
 *
 * Per Cloud Run + Cloud SQL Auth Proxy unix-socket pattern (no TCP).
 *
 * Timeouts: 3 s aligned with umbrella spec §6 C6 (handler total
 * budget ≤ 5 s including JWT validation overhead).
 */

let pool: pg.Pool | undefined;

export function getDbPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      statement_timeout: 3000,
      query_timeout: 3000,
      connectionTimeoutMillis: 3000,
      max: 5,
    });
  }
  return pool;
}

/**
 * Test-only escape hatch. Resets the singleton so subsequent
 * `getDbPool()` calls re-evaluate `DATABASE_URL`. Production code MUST
 * NOT call this.
 */
export function __resetDbPoolForTests(): void {
  pool = undefined;
}
