import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

interface JournalFile {
  entries: Array<{ tag: string }>;
}

describe('integration: migrations applied via globalSetup', () => {
  let handle: TestDbHandle;

  beforeAll(() => {
    handle = createTestDb();
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  test('tabla `usuarios` existe tras runMigrations', async () => {
    const result = await handle.pool.query<{ regclass: string | null }>(
      "SELECT to_regclass('public.usuarios')::text AS regclass",
    );
    expect(result.rows[0].regclass).toBe('usuarios');
  });

  test('count(__drizzle_migrations) == count(journal entries)', async () => {
    const journalPath = resolve(__dirname, '..', '..', 'drizzle', 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf-8')) as JournalFile;
    const expected = journal.entries.length;

    const result = await handle.pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM drizzle.__drizzle_migrations',
    );
    const actual = Number(result.rows[0].count);

    expect(actual).toBe(expected);
  });
});
