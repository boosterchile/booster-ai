import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

describe('integration: health-db', () => {
  let handle: TestDbHandle;

  beforeAll(() => {
    handle = createTestDb();
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  test('Postgres responde a SELECT 1', async () => {
    const result = await handle.pool.query<{ ok: number }>('SELECT 1 AS ok');
    expect(result.rows).toEqual([{ ok: 1 }]);
  });
});
