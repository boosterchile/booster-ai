import { afterEach, describe, expect, it } from 'vitest';
import { __resetDbPoolForTests, getDbPool } from './db.js';

/**
 * Sprint 2c-A T6 — DB pool tests.
 *
 * Verifies the singleton contract:
 *   - Lazy initialization (no Pool constructed at module import).
 *   - Reuse across calls (same instance returned).
 *   - Config snapshot matches the planned timeouts (3 s).
 *
 * Real DB connectivity NOT exercised here; `pg.Pool` is lazy — `new
 * pg.Pool({...})` does not open sockets until `.query()`. T9a/T9b
 * (Firebase emulator integration) and T10a/T10b (race + Admin SDK)
 * exercise the live path.
 */

describe('getDbPool', () => {
  afterEach(() => {
    __resetDbPoolForTests();
  });

  it('returns a singleton: two calls produce the same instance', () => {
    const a = getDbPool();
    const b = getDbPool();
    expect(a).toBe(b);
  });

  it('uses configured timeouts (statement, query, connection: 3000ms)', () => {
    const pool = getDbPool();
    // pg.Pool exposes options on `.options`. We assert against the
    // public config object that pg builds at construction.
    const options = (pool as unknown as { options: Record<string, unknown> }).options;
    expect(options.statement_timeout).toBe(3000);
    expect(options.query_timeout).toBe(3000);
    expect(options.connectionTimeoutMillis).toBe(3000);
    expect(options.max).toBe(5);
  });

  it('reads DATABASE_URL env at construction (lazy until first call)', () => {
    const originalUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgresql://test:test@localhost/test?ssl=false';
    try {
      const pool = getDbPool();
      const options = (pool as unknown as { options: Record<string, unknown> }).options;
      expect(options.connectionString).toBe('postgresql://test:test@localhost/test?ssl=false');
    } finally {
      if (originalUrl === undefined) {
        process.env.DATABASE_URL = undefined;
      } else {
        process.env.DATABASE_URL = originalUrl;
      }
    }
  });
});
