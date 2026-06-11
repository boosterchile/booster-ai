import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * Spec fix-db-integridad-indices §10 T2/T3: tests negativos contra
 * Postgres real. T2 = la FK nueva de 0040. T3 = el unique parcial de
 * membresías stakeholder, que resultó existir desde 0031 (spec §14: el
 * hallazgo de la auditoría era falso; 0040 ya no lo recrea) — este test
 * queda como SU test de regresión, que no tenía: duplicado exacto
 * rechazado, mismo user en organizaciones DISTINTAS permitido.
 */
describe('integration: constraints de la migración 0040', () => {
  let handle: TestDbHandle;

  beforeAll(() => {
    handle = createTestDb();
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  test('T2: documento de conductor inexistente viola la FK', async () => {
    await expect(
      handle.pool.query(
        `INSERT INTO documentos_conductor (conductor_id, tipo) VALUES ($1, 'licencia_conducir')`,
        [randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '23503' }); // foreign_key_violation
  });

  test('T3: doble membership stakeholder mismo (user, org) viola el unique parcial; org distinta NO', async () => {
    const pool = handle.pool;
    const suffix = randomUUID().slice(0, 8);

    const user = await pool.query<{ id: string }>(
      `INSERT INTO usuarios (firebase_uid, nombre_completo, email)
       VALUES ($1, 'Test 0040', $2) RETURNING id`,
      [`fb-0040-${suffix}`, `t0040-${suffix}@test.invalid`],
    );
    const userId = user.rows[0].id;

    const orgA = await pool.query<{ id: string }>(
      `INSERT INTO organizaciones_stakeholder (nombre_legal, tipo)
       VALUES ($1, 'regulador') RETURNING id`,
      [`Org A ${suffix}`],
    );
    const orgB = await pool.query<{ id: string }>(
      `INSERT INTO organizaciones_stakeholder (nombre_legal, tipo)
       VALUES ($1, 'regulador') RETURNING id`,
      [`Org B ${suffix}`],
    );

    const insertMembership = (orgId: string) =>
      pool.query(
        `INSERT INTO membresias (usuario_id, organizacion_stakeholder_id, rol)
         VALUES ($1, $2, 'stakeholder_sostenibilidad')`,
        [userId, orgId],
      );

    await insertMembership(orgA.rows[0].id);
    // Duplicado exacto (user, orgA) → 23505 unique_violation (el UNIQUE
    // viejo con empresa_id NULL no lo atrapaba: NULL≠NULL).
    await expect(insertMembership(orgA.rows[0].id)).rejects.toMatchObject({ code: '23505' });
    // Mismo user, ORGANIZACIÓN DISTINTA → permitido (por eso parcial y no
    // NULLS NOT DISTINCT).
    await expect(insertMembership(orgB.rows[0].id)).resolves.toBeDefined();
  });
});
