import { describe, expect, it } from 'vitest';
import { databaseEnvSchema } from './database.js';

describe('databaseEnvSchema', () => {
  it('parsea URL válida y aplica defaults (pool=10, timeout=5000)', () => {
    const env = databaseEnvSchema.parse({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    });
    expect(env.DATABASE_URL).toBe('postgresql://user:pass@localhost:5432/db');
    expect(env.DATABASE_POOL_MAX).toBe(10);
    expect(env.DATABASE_CONNECT_TIMEOUT_MS).toBe(5000);
  });

  it('rechaza URL inválida', () => {
    expect(() => databaseEnvSchema.parse({ DATABASE_URL: 'not-a-url' })).toThrow();
  });

  it('coerce DATABASE_POOL_MAX desde string', () => {
    const env = databaseEnvSchema.parse({
      DATABASE_URL: 'postgresql://x@y/z',
      DATABASE_POOL_MAX: '25',
    });
    expect(env.DATABASE_POOL_MAX).toBe(25);
  });

  it('rechaza DATABASE_POOL_MAX no-positivo', () => {
    expect(() =>
      databaseEnvSchema.parse({ DATABASE_URL: 'postgresql://x@y/z', DATABASE_POOL_MAX: '0' }),
    ).toThrow();
  });

  it('rechaza missing DATABASE_URL', () => {
    expect(() => databaseEnvSchema.parse({})).toThrow();
  });
});
