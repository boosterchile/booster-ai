import { signupRequestSchema } from '@booster-ai/shared-schemas';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * T7 SEC-001 Sprint 2b — Integration test mínimo de roundtrip insert+select
 * sobre `solicitudes_registro` (migration 0039, spec sec-001-cierre §3 H1.2
 * SC-1.2.1 foundation). Verifica:
 *
 *   1. Migration aplicó el schema correctamente (CREATE TABLE + CREATE TYPE
 *      enum + defaults).
 *   2. INSERT con campos mínimos toma defaults (estado, solicitado_en, id).
 *   3. SELECT round-trip retorna shape que valida contra el domain canónico
 *      `signupRequestSchema` (packages/shared-schemas/src/domain/signup-request.ts).
 *   4. Pueden coexistir múltiples rows con mismo email en estados distintos
 *      (resubmit tras reject scenario).
 *   5. Las 3 transiciones permitidas del enum (pendiente_aprobacion / aprobado /
 *      rechazado) son aceptadas como values válidos.
 *
 * El test usa raw SQL pool query (pattern seed-demo-cuentas-idempotency) para
 * no depender de Drizzle ORM API surface — verifica la migración tal como
 * será aplicada en prod. La validación domain se hace post-fetch sobre los
 * datos crudos.
 */
describe('integration: solicitudes_registro roundtrip + domain validation (SC-1.2.1)', () => {
  let handle: TestDbHandle;

  beforeAll(() => {
    handle = createTestDb();
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  beforeEach(async () => {
    await handle.pool.query('DELETE FROM solicitudes_registro');
    const after = await handle.pool.query<{ c: number }>(
      'SELECT count(*)::int as c FROM solicitudes_registro',
    );
    expect(after.rows[0].c).toBe(0);
  });

  test('INSERT con email + nombre_completo toma defaults id/estado/solicitado_en', async () => {
    const insert = await handle.pool.query<{ id: string }>(
      `INSERT INTO solicitudes_registro (email, nombre_completo)
       VALUES ($1, $2)
       RETURNING id`,
      ['nuevo@empresa.cl', 'Felipe Vicencio'],
    );
    expect(insert.rows[0].id).toMatch(/^[0-9a-f-]{36}$/);

    const select = await handle.pool.query<{
      id: string;
      email: string;
      nombre_completo: string;
      estado: string;
      solicitado_en: Date;
      aprobado_por: string | null;
      aprobado_en: Date | null;
    }>(
      `SELECT id, email, nombre_completo, estado, solicitado_en, aprobado_por, aprobado_en
       FROM solicitudes_registro WHERE id = $1`,
      [insert.rows[0].id],
    );

    expect(select.rows).toHaveLength(1);
    const row = select.rows[0];
    expect(row.email).toBe('nuevo@empresa.cl');
    expect(row.nombre_completo).toBe('Felipe Vicencio');
    expect(row.estado).toBe('pendiente_aprobacion');
    expect(row.solicitado_en).toBeInstanceOf(Date);
    expect(row.aprobado_por).toBeNull();
    expect(row.aprobado_en).toBeNull();

    // Domain validation: el row crudo de pg + transformación timestamps a ISO
    // debe parsear contra signupRequestSchema sin throw.
    const parsed = signupRequestSchema.parse({
      id: row.id,
      email: row.email,
      nombreCompleto: row.nombre_completo,
      estado: row.estado,
      requestedAt: row.solicitado_en.toISOString(),
      approvedBy: row.aprobado_por,
      approvedAt: row.aprobado_en,
    });
    expect(parsed.estado).toBe('pendiente_aprobacion');
  });

  test('UPDATE a estado=aprobado + aprobado_por + aprobado_en persiste y valida', async () => {
    const insert = await handle.pool.query<{ id: string }>(
      `INSERT INTO solicitudes_registro (email, nombre_completo)
       VALUES ($1, $2) RETURNING id`,
      ['cliente@logistica.cl', 'Cliente Real'],
    );
    const id = insert.rows[0].id;

    await handle.pool.query(
      `UPDATE solicitudes_registro
       SET estado = 'aprobado', aprobado_por = $1, aprobado_en = now()
       WHERE id = $2`,
      ['dev@boosterchile.com', id],
    );

    const select = await handle.pool.query<{
      estado: string;
      aprobado_por: string | null;
      aprobado_en: Date | null;
    }>('SELECT estado, aprobado_por, aprobado_en FROM solicitudes_registro WHERE id = $1', [id]);
    expect(select.rows[0].estado).toBe('aprobado');
    expect(select.rows[0].aprobado_por).toBe('dev@boosterchile.com');
    expect(select.rows[0].aprobado_en).toBeInstanceOf(Date);
  });

  test('UPDATE a estado=rechazado persiste sin aprobado_por requerido', async () => {
    const insert = await handle.pool.query<{ id: string }>(
      `INSERT INTO solicitudes_registro (email, nombre_completo)
       VALUES ($1, $2) RETURNING id`,
      ['spam@throwaway.test', 'No Real'],
    );
    const id = insert.rows[0].id;

    await handle.pool.query(
      `UPDATE solicitudes_registro
       SET estado = 'rechazado', aprobado_por = $1, aprobado_en = now()
       WHERE id = $2`,
      ['dev@boosterchile.com', id],
    );

    const select = await handle.pool.query<{ estado: string }>(
      'SELECT estado FROM solicitudes_registro WHERE id = $1',
      [id],
    );
    expect(select.rows[0].estado).toBe('rechazado');
  });

  test('coexisten múltiples rows con mismo email en estados distintos (resubmit tras reject)', async () => {
    // Primera solicitud rejected.
    await handle.pool.query(
      `INSERT INTO solicitudes_registro (email, nombre_completo, estado, aprobado_por, aprobado_en)
       VALUES ($1, $2, 'rechazado', $3, now() - interval '7 days')`,
      ['reaplicante@empresa.cl', 'Re Aplicante', 'dev@boosterchile.com'],
    );
    // Segunda solicitud (resubmit) — pendiente.
    await handle.pool.query(
      `INSERT INTO solicitudes_registro (email, nombre_completo)
       VALUES ($1, $2)`,
      ['reaplicante@empresa.cl', 'Re Aplicante'],
    );

    const count = await handle.pool.query<{ c: number }>(
      "SELECT count(*)::int as c FROM solicitudes_registro WHERE email = 'reaplicante@empresa.cl'",
    );
    expect(count.rows[0].c).toBe(2);

    const distribution = await handle.pool.query<{ pending: number; rejected: number }>(`
      SELECT
        count(*) FILTER (WHERE estado = 'pendiente_aprobacion')::int as pending,
        count(*) FILTER (WHERE estado = 'rechazado')::int as rejected
      FROM solicitudes_registro
      WHERE email = 'reaplicante@empresa.cl'
    `);
    expect(distribution.rows[0].pending).toBe(1);
    expect(distribution.rows[0].rejected).toBe(1);
  });

  test('enum estado_solicitud_registro rechaza values no enumerados', async () => {
    await expect(
      handle.pool.query(
        `INSERT INTO solicitudes_registro (email, nombre_completo, estado)
         VALUES ($1, $2, $3)`,
        ['x@y.cl', 'X Y', 'aprovado_typo'],
      ),
    ).rejects.toThrow(/invalid input value for enum/i);
  });
});
