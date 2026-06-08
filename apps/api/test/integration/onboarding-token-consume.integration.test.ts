import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * T1.5a (onboarding-flow-redesign) — Integration test del CONSUMO ATÓMICO del
 * token one-shot sobre `solicitudes_registro` (migration 0040). Valida, contra
 * Postgres real, la misma cláusula que ejecuta `onboardEmpresa` dentro de su
 * transacción:
 *
 *   UPDATE solicitudes_registro SET consumido_en = now()
 *   WHERE id = $1 AND token_hash = $2 AND consumido_en IS NULL
 *         AND expira_en > now()
 *   RETURNING id
 *
 * Cubre:
 *   1. Consumo concurrente (doble consumo → exactamente UNO gana). Es la
 *      garantía one-shot que el unit test (mocked) no puede probar: depende del
 *      row-lock de Postgres, no del código.
 *   2. Token ya consumido → 0 filas.
 *   3. Token expirado (expira_en en el pasado) → 0 filas.
 *   4. token_hash que no coincide → 0 filas.
 *
 * Usa raw SQL pool query (pattern solicitudes-registro-roundtrip) para verificar
 * la semántica tal como corre en prod, sin depender del ORM. Requiere
 * TEST_DATABASE_URL (testcontainers en CI).
 */

const CONSUME_SQL = `
  UPDATE solicitudes_registro
     SET consumido_en = now()
   WHERE id = $1
     AND token_hash = $2
     AND consumido_en IS NULL
     AND expira_en > now()
   RETURNING id`;

const TOKEN_HASH = 'a'.repeat(64);
const FIREBASE_UID = 'fb-consume-uid';

describe('integration: onboarding token atomic consume (T1.5a)', () => {
  let handle: TestDbHandle;

  beforeAll(() => {
    handle = createTestDb();
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  beforeEach(async () => {
    await handle.pool.query('DELETE FROM solicitudes_registro');
  });

  /** Inserta una solicitud aprobada con token vivo. Devuelve el id. */
  async function insertApprovedWithToken(opts: {
    tokenHash?: string;
    expiresInterval?: string; // p.ej. "1 hour" o "-1 hour" (vencido)
  }): Promise<string> {
    const tokenHash = opts.tokenHash ?? TOKEN_HASH;
    const interval = opts.expiresInterval ?? '1 hour';
    const res = await handle.pool.query<{ id: string }>(
      `INSERT INTO solicitudes_registro
         (email, nombre_completo, estado, aprobado_por, aprobado_en, token_hash, expira_en, firebase_uid)
       VALUES ($1, $2, 'aprobado', $3, now(), $4, now() + ($5)::interval, $6)
       RETURNING id`,
      ['dueno@empresa.cl', 'Dueño Real', 'admin@booster.cl', tokenHash, interval, FIREBASE_UID],
    );
    return res.rows[0].id;
  }

  test('doble consumo concurrente → exactamente uno gana', async () => {
    const id = await insertApprovedWithToken({});

    // Dos consumos en paralelo (conexiones distintas del pool). El row-lock de
    // Postgres serializa: uno setea consumido_en, el otro ve consumido_en NOT
    // NULL → 0 filas.
    const [a, b] = await Promise.all([
      handle.pool.query<{ id: string }>(CONSUME_SQL, [id, TOKEN_HASH]),
      handle.pool.query<{ id: string }>(CONSUME_SQL, [id, TOKEN_HASH]),
    ]);

    const winners = [a, b].filter((r) => r.rows.length === 1).length;
    expect(winners).toBe(1);

    // El row quedó consumido exactamente una vez.
    const check = await handle.pool.query<{ consumido_en: Date | null }>(
      'SELECT consumido_en FROM solicitudes_registro WHERE id = $1',
      [id],
    );
    expect(check.rows[0].consumido_en).toBeInstanceOf(Date);
  });

  test('segundo consumo del mismo token → 0 filas (one-shot)', async () => {
    const id = await insertApprovedWithToken({});
    const first = await handle.pool.query<{ id: string }>(CONSUME_SQL, [id, TOKEN_HASH]);
    expect(first.rows).toHaveLength(1);
    const second = await handle.pool.query<{ id: string }>(CONSUME_SQL, [id, TOKEN_HASH]);
    expect(second.rows).toHaveLength(0);
  });

  test('token expirado (expira_en en el pasado) → 0 filas', async () => {
    const id = await insertApprovedWithToken({ expiresInterval: '-1 hour' });
    const res = await handle.pool.query<{ id: string }>(CONSUME_SQL, [id, TOKEN_HASH]);
    expect(res.rows).toHaveLength(0);
  });

  test('token_hash que no coincide → 0 filas', async () => {
    const id = await insertApprovedWithToken({});
    const res = await handle.pool.query<{ id: string }>(CONSUME_SQL, [id, 'b'.repeat(64)]);
    expect(res.rows).toHaveLength(0);
  });
});
